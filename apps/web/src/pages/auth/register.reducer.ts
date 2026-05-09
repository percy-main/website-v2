/**
 * State + reducer for the registration form draft.
 *
 * Pure (no React) so it can be unit-tested without a renderer.
 * The component owns React-side concerns (mutations, navigation);
 * this file owns "given input X, what is the new draft state?".
 */

export interface RegisterFormState {
  name: string;
  email: string;
  password: string;
  ageConfirmed: boolean;
  ageError: boolean;
}

export function makeInitialRegisterFormState(params: {
  name?: string | null;
  email?: string | null;
}): RegisterFormState {
  return {
    name: params.name ?? "",
    email: params.email ?? "",
    password: "",
    ageConfirmed: false,
    ageError: false,
  };
}

export type RegisterFormAction =
  | { type: "setName"; value: string }
  | { type: "setEmail"; value: string }
  | { type: "setPassword"; value: string }
  | { type: "setAgeConfirmed"; value: boolean }
  | { type: "showAgeError" }
  | { type: "clearAgeError" };

export function registerFormReducer(
  state: RegisterFormState,
  action: RegisterFormAction,
): RegisterFormState {
  switch (action.type) {
    case "setName":
      return { ...state, name: action.value };
    case "setEmail":
      return { ...state, email: action.value };
    case "setPassword":
      return { ...state, password: action.value };
    case "setAgeConfirmed":
      // Toggling the checkbox on always clears any age error.
      return {
        ...state,
        ageConfirmed: action.value,
        ageError: action.value ? false : state.ageError,
      };
    case "showAgeError":
      return { ...state, ageError: true };
    case "clearAgeError":
      return { ...state, ageError: false };
  }
}

/**
 * Whether the form's submit step should proceed. The age error is
 * surfaced via the reducer; this helper just answers "is the user
 * old enough to register?".
 */
export function canSubmitRegisterForm(state: RegisterFormState): boolean {
  return state.ageConfirmed;
}
