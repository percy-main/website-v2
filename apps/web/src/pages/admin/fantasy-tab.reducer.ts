/**
 * State + reducer for the "Create Chaos Week" form on the Fantasy admin tab.
 *
 * Owns all the draft fields together so resetting the form after a
 * successful create is a single dispatch instead of six setState calls,
 * and so picking a rule type can update the rule-config preset
 * atomically (no cascading set-state).
 *
 * Other Fantasy-tab state (sync result/error banners, player search) is
 * intentionally left as plain useState — it lives in different sections
 * with different lifecycles.
 */

const DEFAULT_CONFIGS: Record<string, string> = {
  scoring_modifier: JSON.stringify(
    { sandwich_cost_min: 1, sandwich_cost_max: 1, multiplier: 2 },
    null,
    2,
  ),
  scoring_threshold: JSON.stringify({ min_runs: 30, min_wickets: 3 }, null, 2),
};

export interface ChaosWeekFormState {
  gameweekId: string;
  ruleType: string;
  name: string;
  description: string;
  ruleConfig: string;
  sendEmail: boolean;
}

export const initialChaosWeekFormState: ChaosWeekFormState = {
  gameweekId: "",
  ruleType: "",
  name: "",
  description: "",
  ruleConfig: "",
  sendEmail: false,
};

export type ChaosWeekFormAction =
  | { type: "setGameweekId"; value: string }
  | { type: "setRuleType"; value: string }
  | { type: "setName"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setRuleConfig"; value: string }
  | { type: "setSendEmail"; value: boolean }
  | { type: "reset" };

export function chaosWeekFormReducer(
  state: ChaosWeekFormState,
  action: ChaosWeekFormAction,
): ChaosWeekFormState {
  switch (action.type) {
    case "setGameweekId":
      return { ...state, gameweekId: action.value };
    case "setRuleType": {
      // Picking a rule type seeds (or clears) the rule-config JSON
      // preset atomically so the textarea always matches the rule.
      const ruleConfig =
        action.value in DEFAULT_CONFIGS ? DEFAULT_CONFIGS[action.value] : "";
      return { ...state, ruleType: action.value, ruleConfig };
    }
    case "setName":
      return { ...state, name: action.value };
    case "setDescription":
      return { ...state, description: action.value };
    case "setRuleConfig":
      return { ...state, ruleConfig: action.value };
    case "setSendEmail":
      return { ...state, sendEmail: action.value };
    case "reset":
      return initialChaosWeekFormState;
  }
}

/**
 * Whether the rule-config JSON textarea should be shown — only the two
 * config-driven rule types use it.
 */
export function showsRuleConfig(ruleType: string): boolean {
  return ruleType === "scoring_modifier" || ruleType === "scoring_threshold";
}
