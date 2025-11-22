/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { FunctionCall } from '../state';
// FIX: Import `Type` enum for schema definitions.
import { FunctionResponseScheduling, Type } from '@google/genai';

export const personalAssistantTools: FunctionCall[] = [
  {
    name: 'create_calendar_event',
    description: 'Creates a new event in the user\'s calendar.',
    parameters: {
      // FIX: Use `Type.OBJECT` enum member.
      type: Type.OBJECT,
      properties: {
        summary: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The title or summary of the event.',
        },
        location: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The location of the event.',
        },
        startTime: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The start time of the event in ISO 8601 format.',
        },
        endTime: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The end time of the event in ISO 8601 format.',
        },
      },
      required: ['summary', 'startTime', 'endTime'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'send_email',
    description: 'Sends an email to a specified recipient.',
    parameters: {
      // FIX: Use `Type.OBJECT` enum member.
      type: Type.OBJECT,
      properties: {
        recipient: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The email address of the recipient.',
        },
        subject: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The subject line of the email.',
        },
        body: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The body content of the email.',
        },
      },
      required: ['recipient', 'subject', 'body'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'set_reminder',
    description: 'Sets a reminder for the user.',
    parameters: {
      // FIX: Use `Type.OBJECT` enum member.
      type: Type.OBJECT,
      properties: {
        task: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The task for the reminder.',
        },
        time: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The time for the reminder in ISO 8601 format.',
        },
      },
      required: ['task', 'time'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
];