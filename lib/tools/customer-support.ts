/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// FIX: Import `Type` enum for schema definitions.
import { FunctionResponseScheduling, Type } from '@google/genai';
import { FunctionCall } from '../state';

export const customerSupportTools: FunctionCall[] = [
  {
    name: 'start_return',
    description: 'Starts the return process for an item, collecting necessary details from the user.',
    parameters: {
      // FIX: Use `Type.OBJECT` enum member.
      type: Type.OBJECT,
      properties: {
        orderId: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The ID of the order containing the item to be returned.',
        },
        itemName: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The name of the item the user wants to return.',
        },
        reason: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The reason the user is returning the item.',
        },
      },
      required: ['orderId', 'itemName', 'reason'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'get_order_status',
    description: 'Provides the current status of a user\'s order, searching by order ID or customer details.',
    parameters: {
      // FIX: Use `Type.OBJECT` enum member.
      type: Type.OBJECT,
      properties: {
        orderId: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The ID of the order to check. Ask for this first.',
        },
        customerName: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The name of the customer, if order ID is not available.',
        },
        customerEmail: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'The email of the customer, if order ID is not available.',
        },
      },
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'speak_to_representative',
    description: 'Escalates the conversation to a human customer support representative.',
    parameters: {
      // FIX: Use `Type.OBJECT` enum member.
      type: Type.OBJECT,
      properties: {
        reason: {
          // FIX: Use `Type.STRING` enum member.
          type: Type.STRING,
          description: 'A brief summary of the user\'s issue for the representative.',
        },
      },
      required: ['reason'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
];