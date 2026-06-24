import { ContentBody } from "@/components/content-body.js";
import { OptimisedImage } from "@/components/optimised-image.js";
import { PageLoading } from "@/components/page-loading.js";
import {
  BioEditor,
  bioIsEditable,
  type BioPartialBlock,
} from "@/components/profile/bio-editor.js";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Label } from "@/components/ui/label.js";
import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import { api, callApi } from "@/lib/api-client.js";
import type { paths } from "@/lib/api.gen.js";
import { uploadProfilePhoto } from "@/lib/profile-photo.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";

type EditState =
  paths["/api/profile/edit"]["get"]["responses"][200]["content"]["application/json"];
type SubmitBody =
  paths["/api/profile/edit/proposals"]["post"]["requestBody"]["content"]["application/json"]["body"];
type ProfilePhoto = NonNullable<EditState["profile"]>["photo"];

const profileEditQueryKey = ["profile", "edit"] as const;

export function Component() {
  useDocumentMeta("Edit my profile");

  const { data, isPending, isError } = useQuery({
    queryKey: profileEditQueryKey,
    queryFn: () => callApi(api.GET("/api/profile/edit")),
  });

  if (isPending) return <PageLoading />;

  if (isError) {
    return (
      <Shell>
        <p className="text-destructive">
          We couldn&apos;t load your profile. Please try again later.
        </p>
      </Shell>
    );
  }

  if (!data.profile) {
    return (
      <Shell>
        <Card>
          <CardContent className="py-6">
            <p>
              Your account isn&apos;t linked to a player profile, so
              there&apos;s nothing to edit here. If you think you should have a
              profile, please <Link to="/members">contact a club admin</Link>.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {data.pendingProposal ? (
        <PendingNotice proposal={data.pendingProposal} />
      ) : (
        // Keyed on slug, not contentId: a not-yet-created profile has no
        // contentId, and the slug is stable for the profile's lifetime.
        <EditForm key={data.profile.slug} profile={data.profile} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1>Edit my profile</h1>
        <p className="text-sm text-stone-600">
          Update your bio and photo. Changes are reviewed by a content editor
          before they go live on your public profile.
        </p>
      </div>
      {children}
    </div>
  );
}

function PendingNotice({
  proposal,
}: {
  proposal: NonNullable<EditState["pendingProposal"]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your edit is awaiting review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">
          You submitted this on{" "}
          {new Date(proposal.createdAt).toLocaleDateString("en-GB")}. A content
          editor will approve or reject it, and you&apos;ll get an email either
          way. You can submit another change once this one has been reviewed.
        </p>
        {proposal.photo ? (
          <div>
            <p className="mb-2 text-sm font-medium">Proposed photo</p>
            <OptimisedImage
              picture={proposal.photo}
              alt="Proposed profile photo"
              className="h-32 w-32 rounded-full object-cover"
              width={128}
              height={128}
            />
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-sm font-medium">Proposed bio</p>
          <div className="fc-theme bg-body rounded-md border p-4">
            <ContentBody body={proposal.body} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EditForm({ profile }: { profile: NonNullable<EditState["profile"]> }) {
  const queryClient = useQueryClient();
  const editable = bioIsEditable(profile.body);
  // The latest bio to submit: the edited document when the bio is editable,
  // otherwise the unchanged original (a photo-only change still re-submits
  // the existing bio, which approval simply re-applies). Seeded once - the
  // component is keyed on the profile so it remounts if the profile changes.
  const [body, setBody] = useState<SubmitBody>(() => profile.body);
  const [photo, setPhoto] = useState<ProfilePhoto>(() => profile.photo);
  // Photo consent gates SUBMIT (not the upload button). It is only relevant
  // when the submission includes a photo.
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);

  const needsConsent = photo != null;

  const submit = useMutation({
    mutationFn: () =>
      callApi(
        api.POST("/api/profile/edit/proposals", { body: { body, photo } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileEditQueryKey });
    },
  });

  const onSubmit = () => {
    if (needsConsent && !consent) {
      setConsentError(true);
      return;
    }
    setConsentError(false);
    submit.mutate();
  };

  // Changing the photo or ticking consent clears a previous consent error.
  const onPhotoChange = (next: ProfilePhoto) => {
    setPhoto(next);
    setConsentError(false);
  };
  const onConsentChange = (next: boolean) => {
    setConsent(next);
    if (next) setConsentError(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Photo</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoField
            photo={photo}
            name={profile.title}
            onChange={onPhotoChange}
            consent={consent}
            onConsentChange={onConsentChange}
            consentError={consentError}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bio</CardTitle>
        </CardHeader>
        <CardContent>
          {editable ? (
            <BioEditor
              initialContent={
                profile.body.length > 0
                  ? (profile.body as BioPartialBlock[])
                  : undefined
              }
              onChange={setBody}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-stone-600">
                Your bio contains advanced content that can only be edited by a
                content editor. You can still update your photo here.
              </p>
              <div className="fc-theme bg-body rounded-md border p-4">
                <ContentBody body={profile.body} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {consentError ? (
        <p className="text-destructive text-sm">
          Please tick the box confirming you have permission to use your photo
          before submitting.
        </p>
      ) : null}

      {submit.isError ? (
        <p className="text-destructive text-sm">
          {submit.error instanceof Error
            ? submit.error.message
            : "Something went wrong submitting your change."}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          onClick={onSubmit}
          disabled={submit.isPending || submit.isSuccess}
        >
          {submit.isPending ? "Submitting..." : "Submit for review"}
        </Button>
        <Link to="/members" className="text-sm text-stone-600">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function PhotoField({
  photo,
  name,
  onChange,
  consent,
  onConsentChange,
  consentError,
}: {
  photo: ProfilePhoto;
  name: string;
  onChange: (photo: ProfilePhoto) => void;
  consent: boolean;
  onConsentChange: (consent: boolean) => void;
  consentError: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadProfilePhoto(file);
      onChange(uploaded.picture);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed - please try again",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {photo ? (
          <OptimisedImage
            picture={photo}
            alt={name}
            className="h-32 w-32 rounded-full object-cover"
            width={128}
            height={128}
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-full bg-stone-100 text-sm text-stone-500">
            No photo
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading..." : photo ? "Replace photo" : "Add photo"}
          </Button>
          {photo ? (
            <Button
              type="button"
              variant="ghost"
              disabled={uploading}
              onClick={() => onChange(null)}
            >
              Remove photo
            </Button>
          ) : null}
        </div>
      </div>

      {/* Consent only applies when a photo is part of the submission. It no
          longer gates the upload button - it gates Submit (handled by the
          parent), with a clear error there if it's missing. */}
      {photo ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id="profile-photo-consent"
            checked={consent}
            onCheckedChange={(v) => onConsentChange(v === true)}
          />
          <Label
            htmlFor="profile-photo-consent"
            className={
              consentError
                ? "text-destructive text-sm font-normal"
                : "text-sm font-normal text-stone-600"
            }
          >
            I confirm I have permission to use this photo and consent to it
            being shown on the club website.
          </Label>
        </div>
      ) : null}
      <Label className="sr-only" htmlFor="profile-photo-input">
        Profile photo
      </Label>
      <input
        id="profile-photo-input"
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      {uploadError ? (
        <p className="text-destructive text-sm">{uploadError}</p>
      ) : null}
    </div>
  );
}
