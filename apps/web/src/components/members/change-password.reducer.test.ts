import { describe, expect, it } from "vitest";
import {
  arePasswordsValid,
  changePasswordFormReducer,
  initialChangePasswordFormState,
  MIN_PASSWORD_LENGTH,
  validatePasswordChange,
} from "./change-password.reducer";

describe("changePasswordFormReducer", () => {
  it("starts blank with no success or error", () => {
    expect(initialChangePasswordFormState).toEqual({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      validationError: "",
      success: false,
    });
  });

  it("setCurrentPassword updates the field and clears banners", () => {
    const dirty = {
      ...initialChangePasswordFormState,
      success: true,
      validationError: "stale",
    };
    const next = changePasswordFormReducer(dirty, {
      type: "setCurrentPassword",
      value: "abc",
    });
    expect(next.currentPassword).toBe("abc");
    expect(next.success).toBe(false);
    expect(next.validationError).toBe("");
  });

  it("setNewPassword updates only newPassword and clears banners", () => {
    const dirty = {
      ...initialChangePasswordFormState,
      success: true,
      validationError: "stale",
    };
    const next = changePasswordFormReducer(dirty, {
      type: "setNewPassword",
      value: "newpw",
    });
    expect(next.newPassword).toBe("newpw");
    expect(next.success).toBe(false);
    expect(next.validationError).toBe("");
  });

  it("setConfirmPassword updates only confirmPassword and clears banners", () => {
    const dirty = {
      ...initialChangePasswordFormState,
      validationError: "stale",
    };
    const next = changePasswordFormReducer(dirty, {
      type: "setConfirmPassword",
      value: "newpw",
    });
    expect(next.confirmPassword).toBe("newpw");
    expect(next.validationError).toBe("");
  });

  it("setValidationError sets the error", () => {
    const next = changePasswordFormReducer(initialChangePasswordFormState, {
      type: "setValidationError",
      value: "bad",
    });
    expect(next.validationError).toBe("bad");
  });

  it("submitStart clears the success and error banners", () => {
    const dirty = {
      ...initialChangePasswordFormState,
      success: true,
      validationError: "stale",
    };
    const next = changePasswordFormReducer(dirty, { type: "submitStart" });
    expect(next.success).toBe(false);
    expect(next.validationError).toBe("");
  });

  it("submitSuccess clears all fields and shows success", () => {
    const filled = {
      currentPassword: "old",
      newPassword: "newpassword",
      confirmPassword: "newpassword",
      validationError: "",
      success: false,
    };
    const next = changePasswordFormReducer(filled, { type: "submitSuccess" });
    expect(next).toEqual({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      validationError: "",
      success: true,
    });
  });

  it("reset returns to the initial state", () => {
    const filled = {
      currentPassword: "old",
      newPassword: "newpassword",
      confirmPassword: "newpassword",
      validationError: "err",
      success: true,
    };
    expect(changePasswordFormReducer(filled, { type: "reset" })).toEqual(
      initialChangePasswordFormState,
    );
  });
});

describe("validatePasswordChange", () => {
  it("rejects new passwords shorter than the minimum length", () => {
    const msg = validatePasswordChange("old", "short", "short");
    expect(msg).toContain(`${MIN_PASSWORD_LENGTH}`);
  });

  it("rejects mismatched new + confirm", () => {
    expect(
      validatePasswordChange("old", "longenough1", "different11"),
    ).toBe("New passwords do not match.");
  });

  it("accepts a valid trio (returns null)", () => {
    expect(
      validatePasswordChange("old", "longenough1", "longenough1"),
    ).toBeNull();
  });

  it("rejects empty new even when confirm matches", () => {
    expect(validatePasswordChange("old", "", "")).not.toBeNull();
  });
});

describe("arePasswordsValid", () => {
  it("is true only when validatePasswordChange returns null", () => {
    expect(arePasswordsValid("old", "longenough1", "longenough1")).toBe(true);
    expect(arePasswordsValid("old", "longenough1", "different11")).toBe(false);
    expect(arePasswordsValid("old", "short", "short")).toBe(false);
  });
});
