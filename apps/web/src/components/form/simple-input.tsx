import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FC } from "react";

type Props = React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
> & {
  label: string;
  /**
   * When true, marks the field as invalid (`aria-invalid`) and links it to
   * the error element identified by `errorId` (`aria-describedby`). When
   * false/omitted, no ARIA association is added and behaviour/appearance is
   * unchanged.
   */
  invalid?: boolean;
  /** id of the error element this field is described by, when `invalid`. */
  errorId?: string;
};

export const SimpleInput: FC<Props> = ({
  label,
  invalid,
  errorId,
  ...inputProps
}) => {
  const ariaProps = invalid
    ? { "aria-invalid": true, "aria-describedby": errorId }
    : {};
  if (inputProps.hidden) {
    return <input {...inputProps} {...ariaProps} name={inputProps.id} />;
  }
  return (
    <div className="mb-4 w-full space-y-2">
      <Label htmlFor={inputProps.id}>{label}</Label>
      <Input {...inputProps} {...ariaProps} name={inputProps.id} />
    </div>
  );
};
