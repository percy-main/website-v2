import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, callApi } from "@/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function useMemberDetails() {
  return useQuery({
    queryKey: ["memberDetails"],
    queryFn: () => callApi(api.GET("/api/members/me")),
  });
}

type MemberData = NonNullable<
  Awaited<ReturnType<typeof useMemberDetails>>["data"]
>["member"];

const emptyMember: NonNullable<MemberData> = {
  title: null,
  name: null,
  address: null,
  postcode: null,
  dob: null,
  telephone: null,
  email: "",
  emergency_contact_name: null,
  emergency_contact_telephone: null,
};

const fields: Array<{ key: keyof NonNullable<MemberData>; label: string }> = [
  { key: "title", label: "Title" },
  { key: "name", label: "Name" },
  { key: "address", label: "Address" },
  { key: "postcode", label: "Postcode" },
  { key: "dob", label: "Date of Birth" },
  { key: "telephone", label: "Telephone" },
  { key: "emergency_contact_name", label: "Emergency Contact" },
  { key: "emergency_contact_telephone", label: "Emergency Phone" },
];

function DisplayView({
  member,
  onEdit,
}: {
  member: NonNullable<MemberData>;
  onEdit: () => void;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h4 mb-0">Your Details</h2>
        <Button variant="outline" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        {fields.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="font-medium text-gray-500">{label}</dt>
            <dd>{member[key] ?? "-"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EditView({
  member,
  defaultName,
  onCancel,
  onSaved,
}: {
  member: NonNullable<MemberData> | null;
  defaultName?: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = member ?? { ...emptyMember, name: defaultName ?? null };
  const [form, setForm] = useState<NonNullable<MemberData>>(initial);

  const update = (field: keyof NonNullable<MemberData>, value: string) => {
    setForm({ ...form, [field]: value || null });
  };

  const mutation = useMutation({
    mutationFn: async (data: NonNullable<MemberData>) => {
      return await callApi(
        api.PUT("/api/members/me", {
          body: {
            title: data.title ?? undefined,
            name: data.name ?? undefined,
            address: data.address ?? undefined,
            postcode: data.postcode ?? undefined,
            dob: data.dob ?? undefined,
            telephone: data.telephone ?? undefined,
            emergency_contact_name: data.emergency_contact_name ?? undefined,
            emergency_contact_telephone:
              data.emergency_contact_telephone ?? undefined,
          },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["memberDetails"] });
      onSaved();
    },
  });

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  return (
    <section>
      <h2 className="text-h4">Your Details</h2>
      {!member && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Please complete your details so we can keep in touch and keep you safe
          at the club.
        </div>
      )}
      {mutation.isError && (
        <p className="mb-4 text-sm text-red-600">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Failed to update details. Please try again."}
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h3 className="text-h5">About You</h3>
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={form.title ?? ""}
              onChange={(e) => update("title", e.currentTarget.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="detail-name">Name</Label>
            <Input
              id="detail-name"
              value={form.name ?? ""}
              onChange={(e) => update("name", e.currentTarget.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={form.address ?? ""}
              onChange={(e) => update("address", e.currentTarget.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="postcode">Postcode</Label>
            <Input
              id="postcode"
              value={form.postcode ?? ""}
              onChange={(e) => update("postcode", e.currentTarget.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dob">Date of Birth</Label>
            <Input
              id="dob"
              type="date"
              value={form.dob ?? ""}
              onChange={(e) => update("dob", e.currentTarget.value)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-h5">Contact</h3>
          <div className="grid gap-2">
            <Label htmlFor="telephone">Telephone</Label>
            <Input
              id="telephone"
              type="tel"
              value={form.telephone ?? ""}
              onChange={(e) => update("telephone", e.currentTarget.value)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-h5">Emergency Contact</h3>
          <p className="text-sm text-gray-500">
            We'd like to know some details of an emergency contact so we can
            help ensure you stay safe at the club.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="emergency_contact_name">Contact Name</Label>
            <Input
              id="emergency_contact_name"
              value={form.emergency_contact_name ?? ""}
              onChange={(e) =>
                update("emergency_contact_name", e.currentTarget.value)
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="emergency_contact_telephone">
              Contact Telephone
            </Label>
            <Input
              id="emergency_contact_telephone"
              type="tel"
              value={form.emergency_contact_telephone ?? ""}
              onChange={(e) =>
                update("emergency_contact_telephone", e.currentTarget.value)
              }
            />
          </div>
        </section>

        <div className="flex gap-3">
          <Button type="submit" variant="outline" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save Details"}
          </Button>
          {member && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

export function MemberDetails({ userName }: { userName?: string | null }) {
  const query = useMemberDetails();
  const member = query.data?.member;
  const [editing, setEditing] = useState(false);

  if (query.isLoading) return null;

  if (!member) {
    return (
      <EditView
        member={null}
        defaultName={userName}
        onCancel={() => undefined}
        onSaved={() => undefined}
      />
    );
  }

  if (editing) {
    return (
      <EditView
        member={member}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return <DisplayView member={member} onEdit={() => setEditing(true)} />;
}
