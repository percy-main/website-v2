interface Props<T> {
  id: string;
  options: Array<{
    title: string;
    value: T;
    description?: string;
  }>;
  value: T | undefined;
  onChange: (value: T) => void;
}

export function RadioButtons<T extends string>({
  options,
  id,
  value,
  onChange,
}: Props<T>) {
  return (
    <div className="group relative z-0 mt-2 mb-5 w-full">
      {options.map(({ title, value: radioValue, description }) => (
        <label
          htmlFor={`${id}-${radioValue}`}
          key={`${id}-${radioValue}`}
          className="mb-4 flex items-center"
        >
          <input
            type="radio"
            id={`${id}-${radioValue}`}
            name={id}
            checked={radioValue === value}
            onChange={() => onChange(radioValue)}
          />
          <div className="ms-2 font-medium text-stone-900 dark:text-stone-300">
            {title}
            {description && (
              <p className="text-xs font-normal text-stone-500 dark:text-stone-300">
                {description}
              </p>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}
