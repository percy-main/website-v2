import { cn } from "@/lib/utils";
import { OTPInput, OTPInputContext } from "input-otp";
import * as React from "react";

function InputOTP({
  className,
  containerClassName,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof OTPInput> & {
  ref?: React.Ref<React.ComponentRef<typeof OTPInput>>;
}) {
  return (
    <OTPInput
      ref={ref}
      containerClassName={cn(
        "flex items-center gap-2 has-disabled:opacity-50",
        containerClassName,
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

function InputOTPGroup({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  ref?: React.Ref<React.ComponentRef<"div">>;
}) {
  return (
    <div ref={ref} className={cn("flex items-center", className)} {...props} />
  );
}

function InputOTPSlot({
  index,
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  index: number;
  ref?: React.Ref<React.ComponentRef<"div">>;
}) {
  const inputOTPContext = React.use(OTPInputContext);
  const slot = inputOTPContext.slots[index];
  if (!slot) return null;
  const { char, hasFakeCaret, isActive } = slot;

  return (
    <div
      ref={ref}
      className={cn(
        "border-border relative flex size-10 items-center justify-center border-y border-r text-sm transition-shadow first:rounded-l-md first:border-l last:rounded-r-md",
        isActive && "ring-offset-surface z-10 ring-2 ring-stone-400",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* Blink duration comes from --animate-caret-blink in app.css;
              duration-* here would set transition-duration, not animation. */}
          <div className="animate-caret-blink bg-dark h-4 w-px" />
        </div>
      )}
    </div>
  );
}

function InputOTPSeparator({
  ref,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  ref?: React.Ref<React.ComponentRef<"div">>;
}) {
  return (
    <div ref={ref} role="separator" {...props}>
      <span className="text-muted">-</span>
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };
