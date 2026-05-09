import { SimpleInput } from "@/components/form/simple-input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducer } from "react";

const MIN_PASSWORD_LENGTH = 8;

interface FormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  validationError: string;
  success: boolean;
}

type FormAction =
  | {
      type: "field";
      field: "currentPassword" | "newPassword" | "confirmPassword";
      value: string;
    }
  | { type: "validationError"; message: string }
  | { type: "submitStart" }
  | { type: "submitSucceeded" };

const initialState: FormState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  validationError: "",
  success: false,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "field":
      // Editing any field clears the success / validation status.
      return {
        ...state,
        [action.field]: action.value,
        success: false,
        validationError: "",
      };
    case "validationError":
      return { ...state, validationError: action.message, success: false };
    case "submitStart":
      return { ...state, validationError: "", success: false };
    case "submitSucceeded":
      return { ...initialState, success: true };
  }
}

export function ChangePassword() {
  const queryClient = useQueryClient();
  const [form, dispatch] = useReducer(formReducer, initialState);
  const {
    currentPassword,
    newPassword,
    confirmPassword,
    validationError,
    success,
  } = form;

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error)
        throw new Error(result.error.message ?? "Request failed");
      return result.data;
    },
  });

  const hasPassword = accounts.data?.some((a) => a.providerId === "credential");

  const changePassword = useMutation({
    mutationFn: async (params: {
      currentPassword: string;
      newPassword: string;
    }) => {
      const result = await authClient.changePassword({
        currentPassword: params.currentPassword,
        newPassword: params.newPassword,
        revokeOtherSessions: true,
      });
      if (result.error)
        throw new Error(result.error.message ?? "Request failed");
      return result.data;
    },
    onSuccess: () => {
      dispatch({ type: "submitSucceeded" });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    dispatch({ type: "submitStart" });

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      dispatch({
        type: "validationError",
        message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      dispatch({
        type: "validationError",
        message: "New passwords do not match.",
      });
      return;
    }

    changePassword.mutate({ currentPassword, newPassword });
  };

  if (accounts.isLoading) return null;

  if (!hasPassword) {
    return (
      <section>
        <h2 className="text-h4">Password</h2>
        <p className="text-sm text-stone-600">
          You sign in with Google. No password is required.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-h4">Change Password</h2>
      {success && (
        <p className="mb-4 text-sm text-green-700">
          Your password has been changed successfully.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <SimpleInput
          id="current-password"
          type="password"
          label="Current Password"
          value={currentPassword}
          onChange={(e) =>
            dispatch({
              type: "field",
              field: "currentPassword",
              value: e.currentTarget.value,
            })
          }
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="current-password"
        />
        <SimpleInput
          id="new-password"
          type="password"
          label="New Password"
          value={newPassword}
          onChange={(e) =>
            dispatch({
              type: "field",
              field: "newPassword",
              value: e.currentTarget.value,
            })
          }
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        <SimpleInput
          id="confirm-password"
          type="password"
          label="Confirm New Password"
          value={confirmPassword}
          onChange={(e) =>
            dispatch({
              type: "field",
              field: "confirmPassword",
              value: e.currentTarget.value,
            })
          }
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        {validationError && (
          <p className="mb-4 text-sm text-red-600">{validationError}</p>
        )}
        {changePassword.isError && (
          <p className="mb-4 text-sm text-red-600">
            {changePassword.error?.message ?? "Failed to change password."}
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          disabled={changePassword.isPending}
          className="justify-self-start"
        >
          {changePassword.isPending ? "Changing…" : "Change Password"}
        </Button>
      </form>
    </section>
  );
}
