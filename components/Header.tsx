
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useUI } from '@/lib/state';

export default function Header() {
  const { toggleSidebar } = useUI();
  const appVersion = "0.22.0"; // Increment this version with each change

  return (
    <header>
      <div className="header-left">
        <h1>
          English Conversation Coach
          <span className="version-tag">v{appVersion}</span>
        </h1>
        <p>Practice your speaking skills with an AI tutor.</p>
      </div>
      <div className="header-right">
        <button
          className="settings-button"
          onClick={toggleSidebar}
          aria-label="Settings"
        >
          <span className="icon">tune</span>
        </button>
      </div>
    </header>
  );
}
