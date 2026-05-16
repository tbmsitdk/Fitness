/**
 * Build a binary plist for the "Sync Apple Health" iOS Shortcut.
 *
 * Ports scripts/generate_shortcut.py to TypeScript so we can serve the
 * shortcut as a download from the Next.js app — user doesn't need
 * Python, terminal, or any dev tools.
 */

import bplistCreator from 'bplist-creator';
import { randomUUID } from 'crypto';

type ActionParams = Record<string, unknown>;

function action(identifier: string, params: ActionParams): Record<string, unknown> {
  return {
    WFWorkflowActionIdentifier: identifier,
    WFWorkflowActionParameters: params,
    WFWorkflowActionUUID: randomUUID().toUpperCase(),
  };
}

function outputRef(outputName: string): Record<string, unknown> {
  return {
    Value: { Type: 'ActionOutput', OutputName: outputName },
    WFSerializationType: 'WFTextTokenAttachment',
  };
}

function varRef(variableName: string): Record<string, unknown> {
  return {
    Value: { Type: 'Variable', VariableName: variableName },
    WFSerializationType: 'WFTextTokenAttachment',
  };
}

function healthSampleAction(typeId: string, aggregation: 'Sum' | 'Latest'): Record<string, unknown> {
  return action('is.workflow.actions.health.quantity', {
    WFHealthQuantityTypeIdentifier: typeId,
    WFHealthQuantityAggregation: aggregation,
    WFHealthStartDate: outputRef('Date'),
    WFHealthEndDate: outputRef('Date'),
  });
}

function setVar(name: string, fromOutput = 'Quantity'): Record<string, unknown> {
  return action('is.workflow.actions.setvariable', {
    WFVariableName: name,
    WFInput: outputRef(fromOutput),
  });
}

export function buildShortcutPlist(appUrl: string, syncSecret: string): Buffer {
  const url = appUrl.replace(/\/+$/, '');
  const endpoint = `${url}/api/apple-health-sync`;

  const actions = [
    // 1. Current date → subtract 1 day → format as YYYY-MM-DD → save to "sync_date"
    action('is.workflow.actions.date', { WFDateActionMode: 'Current Date' }),
    action('is.workflow.actions.adjustdate', {
      WFAdjustOperation: 'Subtract',
      WFDuration: {
        Value: { WFDurationUnit: 'days', WFDurationQuantity: 1 },
        WFSerializationType: 'WFQuantitySubstitution',
      },
      WFInput: outputRef('Date'),
    }),
    action('is.workflow.actions.format.date', {
      WFDateFormatStyle: 'Custom',
      WFDateFormat: 'yyyy-MM-dd',
      WFInput: outputRef('Adjusted Date'),
    }),
    action('is.workflow.actions.setvariable', {
      WFVariableName: 'sync_date',
      WFInput: outputRef('Date'),
    }),

    // 2. Steps
    healthSampleAction('HKQuantityTypeIdentifierStepCount', 'Sum'),
    setVar('steps'),

    // 3. Resting HR
    healthSampleAction('HKQuantityTypeIdentifierRestingHeartRate', 'Latest'),
    setVar('resting_hr'),

    // 4. HRV
    healthSampleAction('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'Latest'),
    setVar('hrv_rmssd'),

    // 5. Weight
    healthSampleAction('HKQuantityTypeIdentifierBodyMass', 'Latest'),
    setVar('weight_kg'),

    // 6. Sleep — sum of minutes (server converts to hours)
    healthSampleAction('HKCategoryTypeIdentifierSleepAnalysis', 'Sum'),
    setVar('sleep_min'),

    // 7. Build request body dictionary
    action('is.workflow.actions.dictionary', {
      WFItems: {
        Value: {
          WFDictionaryFieldValueItems: [
            { WFItemType: 0, WFKey: 'date',        WFValue: varRef('sync_date') },
            { WFItemType: 3, WFKey: 'steps',       WFValue: varRef('steps') },
            { WFItemType: 3, WFKey: 'resting_hr',  WFValue: varRef('resting_hr') },
            { WFItemType: 3, WFKey: 'hrv_rmssd',   WFValue: varRef('hrv_rmssd') },
            { WFItemType: 3, WFKey: 'weight_kg',   WFValue: varRef('weight_kg') },
            { WFItemType: 3, WFKey: 'sleep_minutes', WFValue: varRef('sleep_min') },
          ],
        },
        WFSerializationType: 'WFDictionarySubstitution',
      },
    }),
    action('is.workflow.actions.setvariable', {
      WFVariableName: 'body',
      WFInput: outputRef('Dictionary'),
    }),

    // 8. HTTP POST
    action('is.workflow.actions.downloadurl', {
      WFURL: endpoint,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'JSON',
      WFRequestVariable: varRef('body'),
      WFHTTPHeaders: {
        Value: {
          WFDictionaryFieldValueItems: [
            {
              WFItemType: 0,
              WFKey: 'Authorization',
              WFValue: {
                Value: `Bearer ${syncSecret}`,
                WFSerializationType: 'WFTextTokenString',
              },
            },
            {
              WFItemType: 0,
              WFKey: 'Content-Type',
              WFValue: {
                Value: 'application/json',
                WFSerializationType: 'WFTextTokenString',
              },
            },
          ],
        },
        WFSerializationType: 'WFDictionarySubstitution',
      },
    }),

    // 9. Notification
    action('is.workflow.actions.notification', {
      WFNotificationActionTitle: 'Health Synced',
      WFNotificationActionBody: {
        Value: { string: 'Apple Health synced to Fitness App' },
        WFSerializationType: 'WFTextTokenString',
      },
      WFNotificationActionPlaySound: false,
    }),
  ];

  const workflow = {
    WFWorkflowClientVersion: '1240.0.1',
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: 431817727, // teal
      WFWorkflowIconGlyphNumber: 59694,    // heart
    },
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ['NCWidget', 'WatchKit'],
    WFWorkflowActions: actions,
    WFWorkflowHasShortcutInputVariables: false,
    WFQuickActionSurfaces: [],
    WFWorkflowOutputContentItemClasses: [],
    WorkflowMetadata: { WorkflowName: 'Sync Apple Health' },
  };

  return bplistCreator(workflow);
}
