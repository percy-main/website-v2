/**
 * State + reducer for the "Change Password" form.
 *
 * Pure (no React) so it can be unit-tested without a renderer.
 * The component owns the mutation; this file owns the form draft and
 * the validation rules that gate submission.
 */

export const MIN_PASSWORD_LENGTH = 8;

export interface ChangePasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  validationError: string;
  success: boolean;
}

export const initialChangePasswordFormState: ChangePasswordFormState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  validationError: "",
  success: false,
};

export type ChangePasswordFormAction =
  | { type: "setCurrentPassword"; value: string }
  | { type: "setNewPassword"; value: string }
  | { type: "setConfirmPassword"; value: string }
  | { type: "setValidationError"; value: string }
  | { type: "submitStart" }
  | { type: "submitSuccess" }
  | { type: "reset" };

export function changePasswordFormReducer(
  state: ChangePasswordFormState,
  action: ChangePasswordFormAction,
): ChangePasswordFormState {
  switch (action.type) {
    case "setCurrentPassword":
      // Editing any field clears the success banner and stale validation
      // error so the user gets a clean slate on each new attempt.
      return {
        ...state,
        currentPassword: action.value,
        success: false,
        validationError: "",
      };
    case "setNewPassword":
      return {
        ...state,
        newPassword: action.value,
        success: false,
        validationError: "",
      };
    case "setConfirmPassword":
      return {
        ...state,
        confirmPassword: action.value,
        success: false,
        validationError: "",
      };
    case "setValidationError":
      return { ...state, validationError: action.value };
    case "submitStart":
      return { ...state, validationError: "", success: false };
    case "submitSuccess":
      return {
        ...initialChangePasswordFormState,
        success: true,
      };
    case "reset":
      return initialChangePasswordFormState;
  }
}

/**
 * Validate the password trio. Returns null when valid, otherwise an
 * error message suitable for displaying to the user.
 */
export function validatePasswordChange(
  _current: string,
  next: string,
  confirm: string,
): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (next !== confirm) {
    return "New passwords do not match.";
  }
  // current is required (better-auth rejects empty), but the input has
  // required+minLength on it so we don't duplicate that check here.
  // Returning null means "the form is valid; let the API decide if the
  // current password is right".
  return null;
}

/**
 * Convenience predicate: are the three password fields a valid combo?
 */
export function arePasswordsValid(
  current: string,
  next: string,
  confirm: string,
): boolean {
  return validatePasswordChange(current, next, confirm) === null;
}
