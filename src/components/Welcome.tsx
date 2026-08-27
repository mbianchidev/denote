import { FolderOpen, History, Search, ShieldCheck } from "lucide-react";

interface WelcomeProps {
  loading: boolean;
  onChooseVault: () => void;
}

export function Welcome({ loading, onChooseVault }: WelcomeProps) {
  return (
    <main className="welcome">
      <section className="welcome__content">
        <div className="welcome__mark">D</div>
        <h1>Open your notes. Keep your files.</h1>
        <p>
          Denote turns a folder of Markdown into a focused desktop workspace.
          Nothing is uploaded and your notes stay readable everywhere.
        </p>
        <button
          type="button"
          className="primary-button welcome__button"
          disabled={loading}
          onClick={onChooseVault}
        >
          <FolderOpen aria-hidden="true" size={17} />
          {loading ? "Opening vault…" : "Choose a vault folder"}
        </button>
        <div className="welcome__facts">
          <span>
            <Search aria-hidden="true" size={15} />
            Local ZBSearch index
          </span>
          <span>
            <History aria-hidden="true" size={15} />
            Ten revision history
          </span>
          <span>
            <ShieldCheck aria-hidden="true" size={15} />
            Plain UTF-8 files
          </span>
        </div>
      </section>
    </main>
  );
}
