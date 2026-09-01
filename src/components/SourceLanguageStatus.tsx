import {
  AUTOMATIC_LANGUAGE,
  resolveSourceLanguage,
  type SourceLanguageOverride,
} from "../lib/syntaxLanguages";
import { LanguageCombobox } from "./LanguageCombobox";

interface SourceLanguageStatusProps {
  path: string;
  override: SourceLanguageOverride;
  onChange: (override: SourceLanguageOverride) => void;
}

export function SourceLanguageStatus({
  path,
  override,
  onChange,
}: SourceLanguageStatusProps) {
  const resolved = resolveSourceLanguage(path, override);
  const currentLabel = `${resolved.label} (${
    resolved.overridden ? "Override" : "Automatic"
  })`;

  return (
    <span className="status-bar__language">
      <span>Language:</span>
      <LanguageCombobox
        label="Source language"
        value={override ?? AUTOMATIC_LANGUAGE}
        currentLabel={currentLabel}
        onSelect={(choice) =>
          onChange(choice === AUTOMATIC_LANGUAGE ? null : choice)
        }
      />
    </span>
  );
}
