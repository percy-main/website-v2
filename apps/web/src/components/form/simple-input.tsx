import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FC } from "react";

type Props = React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
> & {
  label: string;
};

export const SimpleInput: FC<Props> = ({ label, ...inputProps }) => {
  if (inputProps.hidden) {
    return <input {...inputProps} name={inputProps.id} />;
  }
  return (
    <div className="mb-4 w-full space-y-2">
      <Label htmlFor={inputProps.id}>{label}</Label>
      <Input {...inputProps} name={inputProps.id} />
    </div>
  );
};
