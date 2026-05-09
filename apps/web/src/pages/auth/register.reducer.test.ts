import { describe, expect, it } from "vitest";
import {
  canSubmitRegisterForm,
  makeInitialRegisterFormState,
  registerFormReducer,
  type RegisterFormState,
} from "./register.reducer";

const empty: RegisterFormState = makeInitialRegisterFormState({});

describe("makeInitialRegisterFormState", () => {
  it("defaults all fields to empty/false when no params given", () => {
    expect(makeInitialRegisterFormState({})).toEqual({
      name: "",
      email: "",
      password: "",
      ageConfirmed: false,
      ageError: false,
    });
  });

  it("seeds name and email from search params", () => {
    expect(
      makeInitialRegisterFormState({ name: "Alex", email: "a@b.com" }),
    ).toEqual({
      name: "Alex",
      email: "a@b.com",
      password: "",
      ageConfirmed: false,
      ageError: false,
    });
  });

  it("treats null search params as empty", () => {
    const state = makeInitialRegisterFormState({ name: null, email: null });
    expect(state.name).toBe("");
    expect(state.email).toBe("");
  });
});

describe("registerFormReducer", () => {
  it("setName updates only name", () => {
    const next = registerFormReducer(empty, { type: "setName", value: "Bob" });
    expect(next.name).toBe("Bob");
    expect(next.email).toBe("");
    expect(next.password).toBe("");
  });

  it("setEmail updates only email", () => {
    const next = registerFormReducer(empty, {
      type: "setEmail",
      value: "x@y.com",
    });
    expect(next.email).toBe("x@y.com");
    expect(next.name).toBe("");
  });

  it("setPassword updates only password", () => {
    const next = registerFormReducer(empty, {
      type: "setPassword",
      value: "hunter2",
    });
    expect(next.password).toBe("hunter2");
  });

  it("setAgeConfirmed=true clears any existing age error", () => {
    const withError: RegisterFormState = { ...empty, ageError: true };
    const next = registerFormReducer(withError, {
      type: "setAgeConfirmed",
      value: true,
    });
    expect(next.ageConfirmed).toBe(true);
    expect(next.ageError).toBe(false);
  });

  it("setAgeConfirmed=false leaves the age error untouched", () => {
    const withError: RegisterFormState = { ...empty, ageError: true };
    const next = registerFormReducer(withError, {
      type: "setAgeConfirmed",
      value: false,
    });
    expect(next.ageConfirmed).toBe(false);
    expect(next.ageError).toBe(true);
  });

  it("showAgeError sets the flag", () => {
    const next = registerFormReducer(empty, { type: "showAgeError" });
    expect(next.ageError).toBe(true);
  });

  it("clearAgeError unsets the flag", () => {
    const withError: RegisterFormState = { ...empty, ageError: true };
    const next = registerFormReducer(withError, { type: "clearAgeError" });
    expect(next.ageError).toBe(false);
  });
});

describe("canSubmitRegisterForm", () => {
  it("requires age confirmation", () => {
    expect(canSubmitRegisterForm(empty)).toBe(false);
    expect(canSubmitRegisterForm({ ...empty, ageConfirmed: true })).toBe(true);
  });
});
