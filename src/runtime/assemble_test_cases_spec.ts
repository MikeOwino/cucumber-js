import { IdGenerator, messages } from '@cucumber/messages'
import { ISupportCodeLibrary } from '../support_code_library_builder/types'
import { EventEmitter } from 'events'
import {
  assembleTestCases,
  IAssembledTestCasesMap,
} from './assemble_test_cases'
import { afterEach, beforeEach, describe, it } from 'mocha'
import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import timeMethods from '../time'
import { buildSupportCodeLibrary } from '../../test/runtime_helpers'
import { parse } from '../../test/gherkin_helpers'
import { expect } from 'chai'

interface IRequest {
  gherkinDocument: messages.IGherkinDocument
  pickles: messages.IPickle[]
  supportCodeLibrary: ISupportCodeLibrary
}

interface IResponse {
  envelopes: messages.IEnvelope[]
  result: IAssembledTestCasesMap
}

async function testAssembleTestCases(options: IRequest): Promise<IResponse> {
  const envelopes: messages.IEnvelope[] = []
  const eventBroadcaster = new EventEmitter()
  eventBroadcaster.on('envelope', (e) => envelopes.push(e))
  const result = await assembleTestCases({
    eventBroadcaster,
    newId: IdGenerator.incrementing(),
    pickles: options.pickles,
    supportCodeLibrary: options.supportCodeLibrary,
  })
  return { envelopes, result }
}

describe('assembleTestCases', () => {
  let clock: InstalledClock

  beforeEach(() => {
    clock = FakeTimers.withGlobal(timeMethods).install()
  })

  afterEach(() => {
    clock.uninstall()
  })

  describe('assembleTestCases()', () => {
    it('emits testCase messages', async () => {
      // Arrange
      const supportCodeLibrary = buildSupportCodeLibrary(({ Given }) => {
        Given('a step', function () {
          clock.tick(1)
        })
      })
      const { gherkinDocument, pickles } = await parse({
        data: [
          'Feature: a',
          'Scenario: b',
          'Given a step',
          'Scenario: c',
          'Given a step',
        ].join('\n'),
        uri: 'a.feature',
      })

      // Act
      const { envelopes, result } = await testAssembleTestCases({
        gherkinDocument,
        pickles,
        supportCodeLibrary,
      })

      const testCase1: messages.ITestCase = {
        id: '0',
        pickleId: pickles[0].id,
        testSteps: [
          {
            id: '1',
            pickleStepId: pickles[0].steps[0].id,
            stepDefinitionIds: [supportCodeLibrary.stepDefinitions[0].id],
            stepMatchArgumentsLists: [
              {
                stepMatchArguments: [],
              },
            ],
          },
        ],
      }

      const testCase2: messages.ITestCase = {
        id: '2',
        pickleId: pickles[1].id,
        testSteps: [
          {
            id: '3',
            pickleStepId: pickles[1].steps[0].id,
            stepDefinitionIds: [supportCodeLibrary.stepDefinitions[0].id],
            stepMatchArgumentsLists: [
              {
                stepMatchArguments: [],
              },
            ],
          },
        ],
      }

      // Assert
      expect(envelopes).to.eql([
        messages.Envelope.fromObject({
          testCase: testCase1,
        }),
        messages.Envelope.fromObject({
          testCase: testCase2,
        }),
      ])

      expect(result).to.eql({
        [pickles[0].id]: testCase1,
        [pickles[1].id]: testCase2,
      })
    })

    describe('with a parameterised step', () => {
      it('emits stepMatchArgumentLists correctly within the testCase message', async () => {
        // Arrange
        const supportCodeLibrary = buildSupportCodeLibrary(({ Given }) => {
          Given('a step with {int} and {string} parameters', function () {
            clock.tick(1)
          })
        })
        const { gherkinDocument, pickles } = await parse({
          data: [
            'Feature: a',
            'Scenario: b',
            'Given a step with 1 and "foo" parameters',
          ].join('\n'),
          uri: 'a.feature',
        })

        // Act
        const { envelopes } = await testAssembleTestCases({
          gherkinDocument,
          pickles,
          supportCodeLibrary,
        })

        expect(
          envelopes[0].testCase.testSteps[0].stepMatchArgumentsLists
        ).to.deep.eq([
          messages.TestCase.TestStep.StepMatchArgumentsList.fromObject({
            stepMatchArguments: [
              {
                group: {
                  children: [],
                  start: 12,
                  value: '1',
                },
                parameterTypeName: 'int',
              },
              {
                group: {
                  children: [
                    {
                      children: [
                        {
                          children: [],
                        },
                      ],
                      start: 19,
                      value: 'foo',
                    },
                    {
                      children: [
                        {
                          children: [],
                        },
                      ],
                    },
                  ],
                  start: 18,
                  value: '"foo"',
                },
                parameterTypeName: 'string',
              },
            ],
          }),
        ])
      })
    })

    describe('with test case hooks', () => {
      it('emits the expected envelopes and returns a skipped result', async () => {
        // Arrange
        const supportCodeLibrary = buildSupportCodeLibrary(
          ({ Given, Before, After }) => {
            Given('a step', function () {
              clock.tick(1)
            })
            Before(function () {}) // eslint-disable-line @typescript-eslint/no-empty-function
            After(function () {}) // eslint-disable-line @typescript-eslint/no-empty-function
          }
        )
        const { gherkinDocument, pickles } = await parse({
          data: ['Feature: a', 'Scenario: b', 'Given a step'].join('\n'),
          uri: 'a.feature',
        })

        // Act
        const { envelopes } = await testAssembleTestCases({
          gherkinDocument,
          pickles,
          supportCodeLibrary,
        })

        // Assert
        expect(envelopes[0]).to.eql(
          messages.Envelope.fromObject({
            testCase: {
              id: '0',
              pickleId: pickles[0].id,
              testSteps: [
                {
                  id: '1',
                  hookId: [
                    supportCodeLibrary.beforeTestCaseHookDefinitions[0].id,
                  ],
                },
                {
                  id: '2',
                  pickleStepId: pickles[0].steps[0].id,
                  stepDefinitionIds: [supportCodeLibrary.stepDefinitions[0].id],
                  stepMatchArgumentsLists: [
                    {
                      stepMatchArguments: [],
                    },
                  ],
                },
                {
                  id: '3',
                  hookId: [
                    supportCodeLibrary.afterTestCaseHookDefinitions[0].id,
                  ],
                },
              ],
            },
          })
        )
      })
    })

    describe('with step hooks', () => {
      it('emits the expected envelopes and returns a skipped result', async () => {
        // Arrange
        const supportCodeLibrary = buildSupportCodeLibrary(
          ({ Given, BeforeStep, AfterStep }) => {
            Given('a step', function () {
              clock.tick(1)
            })
            BeforeStep(function () {}) // eslint-disable-line @typescript-eslint/no-empty-function
            AfterStep(function () {}) // eslint-disable-line @typescript-eslint/no-empty-function
          }
        )
        const { gherkinDocument, pickles } = await parse({
          data: ['Feature: a', 'Scenario: b', 'Given a step'].join('\n'),
          uri: 'a.feature',
        })

        // Act
        const { envelopes } = await testAssembleTestCases({
          gherkinDocument,
          pickles,
          supportCodeLibrary,
        })

        // Assert
        expect(envelopes[0]).to.eql(
          messages.Envelope.fromObject({
            testCase: {
              id: '0',
              pickleId: pickles[0].id,
              testSteps: [
                {
                  id: '1',
                  pickleStepId: pickles[0].steps[0].id,
                  stepDefinitionIds: [supportCodeLibrary.stepDefinitions[0].id],
                  stepMatchArgumentsLists: [
                    {
                      stepMatchArguments: [],
                    },
                  ],
                },
              ],
            },
          })
        )
      })
    })
  })
})
