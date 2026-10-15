
'use server';

import { authorizeLegacyUser } from '@/lib/legacy-admin-authorization';

/**
 * @fileOverview An AI flow for processing chat messages between driver and dispatcher.
 *
 * - processChatMessage - A function that takes a message and returns a processed response.
 * - ChatMessageInput - The input type for the processChatMessage function.
 * - ChatMessageOutput - The return type for the processChatMessage function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const ChatMessageInputSchema = z.object({
  text: z.string().optional().describe("The text content of the message, if any."),
  audioDataUri: z.string().optional().describe("An audio recording of the message, as a data URI."),
});
export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>;

const ChatMessageOutputSchema = z.object({
  responseText: z.string().describe("The processed text from the input, either the original text or a transcript of the audio."),
  suggestion: z.string().optional().describe("A suggested quick reply for the recipient."),
  isUrgent: z.boolean().describe("Whether the message content is determined to be urgent."),
});
export type ChatMessageOutput = z.infer<typeof ChatMessageOutputSchema>;

export async function processChatMessage(input: ChatMessageInput): Promise<ChatMessageOutput> {
  if (!await authorizeLegacyUser()) throw new Error("AI authorization required.");
  return chatFlow(input);
}

const prompt = ai.definePrompt({
  name: 'chatPrompt',
  input: {schema: ChatMessageInputSchema},
  output: {schema: ChatMessageOutputSchema},
  prompt: `You are a helpful assistant for a taxi dispatch system. You are processing a message between a driver and a dispatcher.
Your primary job is to transcribe audio to text if it's provided. If text is provided, use that text.
Then, analyze the content of the message.
- Determine if the message is urgent (e.g., mentions an accident, emergency, major delay).
- Provide a short, helpful reply suggestion for the recipient (e.g., "On my way", "Got it, thanks", "What's the address?").

Message to process:
{{#if audioDataUri}}
Audio: {{media url=audioDataUri}}
{{else}}
Text: {{{text}}}
{{/if}}

Provide your response in the specified JSON format.
`,
});

const chatFlow = ai.defineFlow(
  {
    name: 'chatFlow',
    inputSchema: ChatMessageInputSchema,
    outputSchema: ChatMessageOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
