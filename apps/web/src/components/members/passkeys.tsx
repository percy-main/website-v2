import { SimpleInput } from "@/components/form/simple-input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useAuthedQuery, useAuthedQueryKey } from "@/lib/authed-query.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "date-fns";
import { useState } from "react";
import { IoTrashBinOutline } from "react-icons/io5";

export function Passkeys() {
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const queryClient = useQueryClient();
  const authedKey = useAuthedQueryKey();

  const { data: passkeys } = useAuthedQuery({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error)
        throw new Error(result.error.message ?? "Request failed");
      return result.data;
    },
  });

  const deletePasskey = useMutation({
    mutationFn: async (id: string) => {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error)
        throw new Error(result.error.message ?? "Request failed");
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: authedKey(["passkeys"]) });
    },
  });

  const addPasskey = useMutation({
    mutationFn: async (name?: string) => {
      const result = await authClient.passkey.addPasskey({ name });
      if (result.error)
        throw new Error(result.error.message ?? "Request failed");
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: authedKey(["passkeys"]) });
      setNewPasskeyName("");
    },
  });

  return (
    <section>
      <h2 className="text-h4">Your Passkeys</h2>
      <div className="flex flex-col gap-4">
        {passkeys?.map((passkey) => (
          <div
            key={passkey.id}
            className="flex max-w-max flex-row items-center justify-start rounded-2xl border border-stone-500 bg-blue-100 p-4"
          >
            <Button
              variant="ghost"
              size="icon"
              className="mr-4"
              aria-label={`Delete passkey ${passkey.name}`}
              onClick={() => {
                deletePasskey.mutate(passkey.id);
              }}
            >
              <IoTrashBinOutline />
            </Button>
            <div>
              <p>{passkey.name}</p>
              <p className="text-sm">
                {formatDate(passkey.createdAt, "dd/MM/yyyy HH:mm")}
              </p>
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addPasskey.mutate(newPasskeyName);
        }}
        className="py-4"
      >
        <SimpleInput
          id="name"
          label="Passkey Name"
          value={newPasskeyName}
          onChange={(e) => {
            setNewPasskeyName(e.currentTarget.value);
          }}
          required
          autoComplete="off"
        />
        <Button type="submit" variant="outline" disabled={!newPasskeyName}>
          Add new passkey
        </Button>
      </form>
    </section>
  );
}
