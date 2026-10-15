'use server';

import { authorizeLegacyUser } from '@/lib/legacy-admin-authorization';

/**
 * @fileOverview A dispatching suggestions AI agent.
 *
 * - getDispatchingSuggestions - A function that provides real-time suggestions for driver assignments and re-assignments.
 * - DispatchingSuggestionsInput - The input type for the getDispatchingSuggestions function.
 * - DispatchingSuggestionsOutput - The return type for the getDispatchingSuggestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DispatchingSuggestionsInputSchema = z.object({
  availableDrivers: z.array(z.object({
    driverId: z.string().describe('The unique identifier of the driver.'),
    currentLocation: z.string().describe('The current location of the driver as a coordinate string like "(x, y)".'),
    availabilityStatus: z.enum(['available', 'unavailable']).describe('The availability status of the driver.'),
  })).describe('A list of available drivers with their current locations and availability status.'),
  pendingRideRequests: z.array(z.object({
    requestId: z.string().describe('The unique identifier of the ride request.'),
    pickupLocation: z.string().describe('The pickup location of the ride request.'),
    dropoffLocation: z.string().describe('The dropoff location of the ride request.'),
    passengerCount: z.number().describe('The number of passengers.'),
    movingFee: z.boolean().describe('Whether a moving fee applies.'),
    scheduledTime: z.string().optional().describe('The scheduled time for pickup, if any.')
  })).describe('A list of pending ride requests with their pickup and dropoff locations.'),
});
export type DispatchingSuggestionsInput = z.infer<typeof DispatchingSuggestionsInputSchema>;

const DispatchingSuggestionsOutputSchema = z.object({
  driverAssignmentSuggestions: z.array(z.object({
    driverId: z.string().describe('The unique identifier of the driver.'),
    rideRequestId: z.string().describe('The unique identifier of the ride request to assign the driver to.'),
    reason: z.string().describe('The reasoning behind the driver assignment suggestion.'),
  })).describe('A list of driver assignment suggestions.'),
  driverReassignmentSuggestions: z.array(z.object({
    driverId: z.string().describe('The unique identifier of the driver to reassign.'),
    newRideRequestId: z.string().describe('The unique identifier of the new ride request to assign the driver to.'),
    reason: z.string().describe('The reasoning behind the driver reassignment suggestion.'),
  })).describe('A list of driver reassignment suggestions.'),
});
export type DispatchingSuggestionsOutput = z.infer<typeof DispatchingSuggestionsOutputSchema>;

export async function getDispatchingSuggestions(input: DispatchingSuggestionsInput): Promise<DispatchingSuggestionsOutput> {
  if (!await authorizeLegacyUser()) throw new Error("AI authorization required.");
  return dispatchingSuggestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'dispatchingSuggestionsPrompt',
  input: {schema: DispatchingSuggestionsInputSchema},
  output: {schema: DispatchingSuggestionsOutputSchema},
  prompt: `You are an expert taxi dispatcher, skilled at optimizing ride assignments to minimize passenger wait times and maximize driver efficiency.

  Given the following information, provide suggestions for driver assignments and re-assignments.

  Available Drivers:
  {{#each availableDrivers}}
  - Driver ID: {{{driverId}}}, Current Location: {{{currentLocation}}}, Availability: {{{availabilityStatus}}}
  {{/each}}

  Pending Ride Requests:
  {{#each pendingRideRequests}}
  - Request ID: {{{requestId}}}, Pickup: {{{pickupLocation}}}, Dropoff: {{{dropoffLocation}}}, Passengers: {{{passengerCount}}}{{#if movingFee}}, Moving Fee{{/if}}{{#if scheduledTime}}, Scheduled: {{{scheduledTime}}}{{/if}}
  {{/each}}

  Consider factors such as driver proximity to pickup locations, estimated travel times, driver availability, passenger count, and any special conditions like moving fees or scheduled times when making your suggestions.
  Your suggestions should be based on the provided data. Do not invent new locations or ride requests.
  
  Provide your suggestions in the specified JSON format. If there are no suggestions to make, return empty lists for both driverAssignmentSuggestions and driverReassignmentSuggestions.
`,
});

const dispatchingSuggestionsFlow = ai.defineFlow(
  {
    name: 'dispatchingSuggestionsFlow',
    inputSchema: DispatchingSuggestionsInputSchema,
    outputSchema: DispatchingSuggestionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
