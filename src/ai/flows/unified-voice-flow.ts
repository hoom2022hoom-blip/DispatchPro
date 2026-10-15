'use server';

import { authorizeLegacyUser } from '@/lib/legacy-admin-authorization';

/**
 * @fileOverview An AI flow for parsing various voice inputs, either logging a new call or executing a command.
 *
 * - processVoiceInput - A function that takes an audio recording and returns a structured action.
 * - VoiceInput - The input type for the processVoiceInput function.
 * - VoiceOutput - The return type for the processVoiceInput function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { VoiceOutputSchema } from '@/ai/schemas';


const VoiceInputSchema = z.object({
  audioDataUri: z
    .string()
    .describe(
      "An audio recording of a call, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
   rides: z.array(z.object({
      id: z.string(),
      status: z.string(),
  })).describe('The list of current rides.'),
    drivers: z.array(z.object({
        id: z.string(),
        name: z.string(),
    })).describe('The list of available drivers.')
});
export type VoiceInput = z.infer<typeof VoiceInputSchema>;
export type VoiceOutput = z.infer<typeof VoiceOutputSchema>;


export async function processVoiceInput(input: VoiceInput): Promise<VoiceOutput> {
  if (!await authorizeLegacyUser()) throw new Error("AI authorization required.");
  return unifiedVoiceFlow(input);
}

const prompt = ai.definePrompt({
  name: 'unifiedVoicePrompt',
  input: {schema: VoiceInputSchema},
  output: {schema: VoiceOutputSchema},
  prompt: `You are an expert taxi dispatcher assistant. Your task is to listen to a recorded audio clip and determine the user's intent. The user could be either logging a new ride request or issuing a command to manage existing rides.

The current date and time is ${new Date().toISOString()}.

Here is the current state of the system:
- Rides: {{json rides}}
- Drivers: {{json drivers}}

Listen to the following audio and determine the intent.
Audio: {{media url=audioDataUri}}

---

**Intent 1: Create a New Ride**
If the user is describing a new ride request (e.g., a phone call with a customer), extract the following details:
  - Passenger's phone number.
  - Pickup location.
  - Dropoff location.
  - Number of passengers.
  - If a specific pickup time is mentioned. If so, provide it in ISO 8601 format.
  - If this is a "moving" service, which implies the movingFee should be true.
  Respond with \`intent: 'create'\` and populate the corresponding fields.

**Intent 2: Manage an Existing Ride**
If the user is issuing a command about an existing ride (e.g., "assign ride one to driver two"), parse the command.
  - You need to correctly identify rides and drivers. Ride IDs are in the format "ride-X" and driver IDs are in "driver-X". The user might say "ride one" which you should map to "ride-1".
  - Possible Actions: 'assign', 'updateStatus', 'delete', 'cancel'.
  - Analyze the command and determine the appropriate action and parameters.
  - Respond with \`intent: 'manage'\` and populate the corresponding fields.

**Intent 3: Unknown**
If you cannot clearly determine the intent or if the audio is unclear, respond with \`intent: 'unknown'\` and provide a reasoning.

---

Provide your response in the specified JSON format based on the determined intent.
`,
});

const unifiedVoiceFlow = ai.defineFlow(
  {
    name: 'unifiedVoiceFlow',
    inputSchema: VoiceInputSchema,
    outputSchema: VoiceOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
