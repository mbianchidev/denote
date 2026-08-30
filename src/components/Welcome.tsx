import {
  FolderClock,
  FolderOpen,
  History,
  Search,
  ShieldCheck,
} from "lucide-react";

interface WelcomeProps {
  loading: boolean;
  onChooseVault: () => void;
  onShowRecentVaults: () => void;
}

export function Welcome({
  loading,
  onChooseVault,
  onShowRecentVaults,
}: WelcomeProps) {
  return (
    <main className="welcome">
      <section className="welcome__content">
        <div className="welcome__mark">D</div>
        <h1>Open your notes. Keep your files.</h1>
        <p>
          Denote turns a folder of Markdown into a focused desktop workspace.
          Nothing is uploaded and your notes stay readable everywhere.
        </p>
        <div className="welcome__actions">
          <button
            type="button"
            className="primary-button welcome__button"
            disabled={loading}
            onClick={onChooseVault}
          >
            <FolderOpen aria-hidden="true" size={17} />
            {loading ? "Opening vault…" : "Choose a vault folder"}
          </button>
          <button
            type="button"
            className="secondary-button welcome__button"
            disabled={loading}
            onClick={onShowRecentVaults}
          >
            <FolderClock aria-hidden="true" size={17} />
            Recent vaults
          </button>
        </div>
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
