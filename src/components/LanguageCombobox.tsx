import { Check, ChevronDown, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import {
  LANGUAGE_OPTIONS,
  type LanguageChoice,
  type LanguageOption,
} from "../lib/syntaxLanguages";

interface LanguageComboboxProps {
  label: string;
  value: LanguageChoice | null;
  currentLabel: string;
  disabled?: boolean;
  options?: readonly LanguageOption[];
  onSelect: (value: LanguageChoice) => void;
}

export function LanguageCombobox({
  label,
  value,
  currentLabel,
  disabled = false,
  options = LANGUAGE_OPTIONS,
  onSelect,
}: LanguageComboboxProps) {
  const id = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredOptions = useMemo(
    () => filterLanguageOptions(options, query),
    [options, query],
  );
  const selectedIndex = filteredOptions.findIndex(
    (option) => option.value === value,
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    if (option && wrapperRef.current?.contains(option)) {
      option.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex, filteredOptions, id, open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  };

  const select = (option: LanguageOption) => {
    onSelect(option.value);
    close(true);
  };

  const moveActive = (direction: -1 | 1) => {
    if (filteredOptions.length === 0) {
      return;
    }
    setActiveIndex(
      (current) =>
        (current + direction + filteredOptions.length) %
        filteredOptions.length,
    );
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      wrapperRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }
    close(false);
  };

  const activeOption = filteredOptions[activeIndex] ?? null;
  const listboxId = `${id}-listbox`;

  return (
    <div
      ref={wrapperRef}
      className="language-combobox"
      data-open={open || undefined}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className="language-combobox__trigger"
        aria-label={`${label}: ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close(false);
          } else {
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{currentLabel}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      {open ? (
        <div className="language-combobox__popover">
          <label className="language-combobox__search">
            <Search aria-hidden="true" size={13} />
            <span className="sr-only">Search {label.toLocaleLowerCase()}</span>
            <input
              ref={inputRef}
              role="combobox"
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-activedescendant={
                activeOption ? `${id}-option-${activeIndex}` : undefined
              }
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveActive(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveActive(-1);
                } else if (event.key === "Enter" && activeOption) {
                  event.preventDefault();
                  select(activeOption);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                }
              }}
            />
          </label>
          <div
            id={listboxId}
            className="language-combobox__options"
            role="listbox"
            aria-label={`${label} options`}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const selected = option.value === value;
                return (
                  <div
                    id={`${id}-option-${index}`}
                    key={option.value}
                    className="language-combobox__option"
                    role="option"
                    aria-selected={selected}
                    data-active={index === activeIndex || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => select(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? (
                      <>
                        <span className="sr-only">Current selection</span>
                        <Check aria-hidden="true" size={13} />
                      </>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="language-combobox__empty" role="status">
                No supported languages match.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function filterLanguageOptions(
  options: readonly LanguageOption[],
  query: string,
): LanguageOption[] {
  const normalized = normalizeSearch(query);
  if (!normalized) {
    return [...options];
  }
  return options.filter((option) =>
    option.searchTerms.some((term) =>
      normalizeSearch(term).includes(normalized),
    ),
  );
}

function normalizeSearch(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase();
}
