'use server';

import { authorizeLegacyUser } from '@/lib/legacy-admin-authorization';

/**
 * @fileOverview A driver ETA prediction AI agent.
 *
 * - predictDriverEta - A function that predicts the estimated time of arrival (ETA) of a driver.
 * - DriverEtaPredictionInput - The input type for the predictDriverEta function.
 * - DriverEtaPredictionOutput - The return type for the predictDriverEta function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';

const DriverEtaPredictionInputSchema = z.object({
  pickupLocation: z.string().describe('The pickup location of the passenger.'),
  dropoffLocation: z.string().describe('The dropoff location of the passenger.'),
  driverLocation: z.string().describe('The current location of the driver.'),
  trafficConditions: z.string().describe('The current traffic conditions.'),
  timeOfDay: z.string().describe('The time of day the ride is requested.'),
});
export type DriverEtaPredictionInput = z.infer<
  typeof DriverEtaPredictionInputSchema
>;

const DriverEtaPredictionOutputSchema = z.object({
  estimatedTimeOfArrival: z
    .string()
    .describe('The estimated time of arrival (ETA) of the driver.'),
  confidenceLevel: z
    .string()
    .describe('The confidence level of the ETA prediction.'),
  reasoning: z.string().describe('The reasoning behind the ETA prediction.'),
});
export type DriverEtaPredictionOutput = z.infer<
  typeof DriverEtaPredictionOutputSchema
>;

export async function predictDriverEta(
  input: DriverEtaPredictionInput
): Promise<DriverEtaPredictionOutput> {
  if (!await authorizeLegacyUser()) throw new Error("AI authorization required.");
  return predictDriverEtaFlow(input);
}

const prompt = ai.definePrompt({
  name: 'driverEtaPredictionPrompt',
  input: {schema: DriverEtaPredictionInputSchema},
  output: {schema: DriverEtaPredictionOutputSchema},
  prompt: `You are an expert in predicting the estimated time of arrival (ETA) for taxi drivers. Use the provided information to predict the ETA and provide a confidence level for your prediction.

Pickup Location: {{{pickupLocation}}}
Dropoff Location: {{{dropoffLocation}}}
Driver Location: {{{driverLocation}}}
Traffic Conditions: {{{trafficConditions}}}
Time of Day: {{{timeOfDay}}}

Provide the ETA, confidence level, and reasoning behind your prediction.`,
});

const predictDriverEtaFlow = ai.defineFlow(
  {
    name: 'predictDriverEtaFlow',
    inputSchema: DriverEtaPredictionInputSchema,
    outputSchema: DriverEtaPredictionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
