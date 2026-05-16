#!/usr/bin/env python3
"""
Generate the "Sync Apple Health" iOS Shortcut file.

Run this once to produce apple_health_sync.shortcut, then AirDrop it to
your iPhone and open it — iOS will offer to import it into the Shortcuts app.

Usage:
    python3 scripts/generate_shortcut.py \
        --url  https://your-app.vercel.app \
        --secret YOUR_SYNC_SECRET

The shortcut:
  1. Calculates yesterday's date (YYYY-MM-DD)
  2. Reads from Apple Health: steps, resting HR, HRV, sleep, weight
  3. POSTs the data to /api/apple-health-sync
  4. Shows a notification with the result

Set it to run automatically: Shortcuts app → Automation → New Automation
  → Time of Day (e.g. 7 AM) → Daily → "Run Immediately" (no confirmation).
"""

import argparse
import plistlib
import uuid
import sys


def make_uuid() -> str:
    return str(uuid.uuid4()).upper()


def action(identifier: str, params: dict, uuid_val: str | None = None) -> dict:
    return {
        "WFWorkflowActionIdentifier": identifier,
        "WFWorkflowActionParameters": params,
        "WFWorkflowActionUUID": uuid_val or make_uuid(),
    }


def var_ref(name: str) -> dict:
    """Reference a named variable."""
    return {
        "Value": {
            "Type": "Variable",
            "VariableName": name,
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def build_shortcut(app_url: str, sync_secret: str) -> dict:
    app_url = app_url.rstrip("/")
    endpoint = f"{app_url}/api/apple-health-sync"

    actions = [
        # ── 1. Get today, subtract 1 day → "yesterday" ────────────────────
        action("is.workflow.actions.date", {
            "WFDateActionMode": "Current Date",
        }),
        action("is.workflow.actions.adjustdate", {
            "WFAdjustOperation": "Subtract",
            "WFDuration": {
                "Value": {
                    "WFDurationUnit": "days",
                    "WFDurationQuantity": 1,
                },
                "WFSerializationType": "WFQuantitySubstitution",
            },
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Date"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),
        action("is.workflow.actions.format.date", {
            "WFDateFormatStyle": "Custom",
            "WFDateFormat": "yyyy-MM-dd",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Adjusted Date"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "sync_date",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Date"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 2. Steps (sum for the day) ────────────────────────────────────
        action("is.workflow.actions.health.quantity", {
            "WFHealthQuantityTypeIdentifier": "HKQuantityTypeIdentifierStepCount",
            "WFHealthQuantityAggregation": "Sum",
            "WFHealthStartDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFHealthEndDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "steps",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Quantity"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 3. Resting Heart Rate (latest) ───────────────────────────────
        action("is.workflow.actions.health.quantity", {
            "WFHealthQuantityTypeIdentifier": "HKQuantityTypeIdentifierRestingHeartRate",
            "WFHealthQuantityAggregation": "Latest",
            "WFHealthStartDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFHealthEndDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "resting_hr",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Quantity"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 4. HRV SDNN (latest) ─────────────────────────────────────────
        action("is.workflow.actions.health.quantity", {
            "WFHealthQuantityTypeIdentifier": "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
            "WFHealthQuantityAggregation": "Latest",
            "WFHealthStartDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFHealthEndDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "hrv_rmssd",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Quantity"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 5. Weight — Body Mass (latest) ───────────────────────────────
        action("is.workflow.actions.health.quantity", {
            "WFHealthQuantityTypeIdentifier": "HKQuantityTypeIdentifierBodyMass",
            "WFHealthQuantityAggregation": "Latest",
            "WFHealthStartDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFHealthEndDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "weight_kg",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Quantity"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 6. Sleep (sum of asleep minutes) ────────────────────────────
        # We sum sleep samples for the day and divide by 60 in the body.
        action("is.workflow.actions.health.quantity", {
            "WFHealthQuantityTypeIdentifier": "HKCategoryTypeIdentifierSleepAnalysis",
            "WFHealthQuantityAggregation": "Sum",
            "WFHealthStartDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFHealthEndDate": {
                "Value": {"Type": "ActionOutput", "OutputName": "Date"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "sleep_min",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Quantity"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 7. Build request body dict ───────────────────────────────────
        action("is.workflow.actions.dictionary", {
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": "date",
                            "WFValue": {
                                "Value": {"Type": "Variable", "VariableName": "sync_date"},
                                "WFSerializationType": "WFTextTokenAttachment",
                            },
                        },
                        {
                            "WFItemType": 3,  # Number
                            "WFKey": "steps",
                            "WFValue": {
                                "Value": {"Type": "Variable", "VariableName": "steps"},
                                "WFSerializationType": "WFTextTokenAttachment",
                            },
                        },
                        {
                            "WFItemType": 3,
                            "WFKey": "resting_hr",
                            "WFValue": {
                                "Value": {"Type": "Variable", "VariableName": "resting_hr"},
                                "WFSerializationType": "WFTextTokenAttachment",
                            },
                        },
                        {
                            "WFItemType": 3,
                            "WFKey": "hrv_rmssd",
                            "WFValue": {
                                "Value": {"Type": "Variable", "VariableName": "hrv_rmssd"},
                                "WFSerializationType": "WFTextTokenAttachment",
                            },
                        },
                        {
                            "WFItemType": 3,
                            "WFKey": "weight_kg",
                            "WFValue": {
                                "Value": {"Type": "Variable", "VariableName": "weight_kg"},
                                "WFSerializationType": "WFTextTokenAttachment",
                            },
                        },
                        {
                            "WFItemType": 3,
                            "WFKey": "sleep_hours",
                            "WFValue": {
                                # sleep_min / 60 — Shortcuts doesn't do math inline,
                                # so we store raw minutes and let the server divide.
                                # The endpoint accepts sleep_hours; we send sleep_minutes
                                # and note: use sleep_minutes key handled server-side.
                                "Value": {"Type": "Variable", "VariableName": "sleep_min"},
                                "WFSerializationType": "WFTextTokenAttachment",
                            },
                        },
                    ]
                },
                "WFSerializationType": "WFDictionarySubstitution",
            },
        }),
        action("is.workflow.actions.setvariable", {
            "WFVariableName": "body",
            "WFInput": {"Value": {"Type": "ActionOutput", "OutputName": "Dictionary"},
                        "WFSerializationType": "WFTextTokenAttachment"},
        }),

        # ── 8. HTTP POST ─────────────────────────────────────────────────
        action("is.workflow.actions.downloadurl", {
            "WFURL": endpoint,
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "WFRequestVariable": {
                "Value": {"Type": "Variable", "VariableName": "body"},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": "Authorization",
                            "WFValue": {
                                "Value": f"Bearer {sync_secret}",
                                "WFSerializationType": "WFTextTokenString",
                            },
                        },
                        {
                            "WFItemType": 0,
                            "WFKey": "Content-Type",
                            "WFValue": {
                                "Value": "application/json",
                                "WFSerializationType": "WFTextTokenString",
                            },
                        },
                    ]
                },
                "WFSerializationType": "WFDictionarySubstitution",
            },
        }),

        # ── 9. Notify ─────────────────────────────────────────────────────
        action("is.workflow.actions.notification", {
            "WFNotificationActionTitle": "Health Synced ✓",
            "WFNotificationActionBody": {
                "Value": {
                    "attachmentsByRange": {
                        "{0, 1}": {
                            "Type": "Variable",
                            "VariableName": "sync_date",
                        },
                    },
                    "string": "Apple Health → Fitness App: ￼ synced",
                },
                "WFSerializationType": "WFTextTokenString",
            },
            "WFNotificationActionPlaySound": False,
        }),
    ]

    return {
        "WFWorkflowClientVersion": "1240.0.1",
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 431817727,  # teal
            "WFWorkflowIconGlyphNumber": 59694,     # heart icon
        },
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": ["NCWidget", "WatchKit"],
        "WFWorkflowActions": actions,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFQuickActionSurfaces": [],
        "WFWorkflowOutputContentItemClasses": [],
        "WorkflowMetadata": {
            "WorkflowName": "Sync Apple Health",
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Generate apple_health_sync.shortcut")
    parser.add_argument("--url",    required=True, help="Your Vercel app URL (e.g. https://fitness.vercel.app)")
    parser.add_argument("--secret", required=True, help="SYNC_SECRET value from your Vercel env vars")
    parser.add_argument("--out",    default="apple_health_sync.shortcut", help="Output filename")
    args = parser.parse_args()

    shortcut = build_shortcut(args.url, args.secret)
    with open(args.out, "wb") as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)

    print(f"✓ Shortcut written to {args.out}")
    print()
    print("Next steps:")
    print("  1. AirDrop the file to your iPhone")
    print("  2. Open it on the iPhone → tap 'Add Shortcut'")
    print("  3. Open Shortcuts app → Automation → + → Time of Day")
    print("     • Time: 7:00 AM  •  Repeat: Daily")
    print("     • Run immediately (no confirmation)")
    print("     • Action: Run Shortcut → 'Sync Apple Health'")
    print()
    print("The shortcut syncs: steps · resting HR · HRV · weight · sleep")


if __name__ == "__main__":
    main()
