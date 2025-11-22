/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import './WelcomeScreen.css';
import { usePrompts } from '../../../lib/state';
import { promptContent, PromptTemplate } from '@/lib/prompts';

const WelcomeScreen: React.FC = () => {
  const {
    template,
    setTemplate,
    topics,
    toggleTopic,
    customTopics,
    setCustomTopics,
  } = usePrompts();
  const { description, prompts } = promptContent[template];
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="title-container">
          <span className="welcome-icon">record_voice_over</span>
          <div className="title-selector">
            <select
              value={template}
              onChange={e => setTemplate(e.target.value as PromptTemplate)}
              aria-label="Select a conversation category"
            >
              <option value="daily-life">Daily Life</option>
              <option value="professional">Professional</option>
              <option value="creative">Creative</option>
              <option value="travel">Travel</option>
              <option value="health">Health</option>
            </select>
            <span className="icon">arrow_drop_down</span>
          </div>
        </div>
        <p>{description}</p>
        <div className="sidebar-section">
          <h4 className="sidebar-section-title">Conversation Topics</h4>
          <div className="tools-list">
            {topics.map(topic => (
              <div key={topic.name} className="tool-item">
                <label className="tool-checkbox-wrapper">
                  <input
                    type="checkbox"
                    id={`tool-checkbox-welcome-${topic.name}`}
                    checked={topic.isEnabled}
                    onChange={() => toggleTopic(topic.name)}
                  />
                  <span className="checkbox-visual"></span>
                </label>
                <label
                  htmlFor={`tool-checkbox-welcome-${topic.name}`}
                  className="tool-name-text"
                >
                  {topic.name}
                </label>
              </div>
            ))}
          </div>
          <textarea
            className="custom-topics-input"
            value={customTopics}
            onChange={e => setCustomTopics(e.target.value)}
            placeholder="Or add your own topics, separated by commas..."
            rows={2}
          />
        </div>
        <div className="example-prompts">
          {prompts.map((prompt, index) => (
            <div key={index} className="prompt">
              {prompt}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;