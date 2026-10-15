
"use server";

import 'dotenv/config';
import { authorizeLegacyUser } from '@/lib/legacy-admin-authorization';
import { z } from "zod";
import { db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp, writeBatch, getDoc } from 'firebase/firestore';
import { revalidatePath } from 'next/cache';
import { Role } from '@/lib/types';

const updateUserProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string().min(2, { message: "Display name must be at least 2 characters." }).optional(),
  phoneNumber: z.string().optional(),
  sendAssignmentNotifications: z.preprocess((val) => val === 'on' || val === true, z.boolean()).optional(),
});

export async function updateUserProfile(prevState: any, formData: FormData) {
    const actor = await authorizeLegacyUser();
    if (!actor || formData.get('userId') !== actor.uid) return {type:'error',message:'Profile authorization required.'};
    const formValues = Object.fromEntries(formData.entries());
    const validatedFields = updateUserProfileSchema.safeParse(formValues);

    if (!validatedFields.success) {
        return {
            type: "error",
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Invalid details provided.",
        };
    }
    
    const { userId, ...updateData } = validatedFields.data;

    if (Object.keys(updateData).length === 0) {
        return { type: "success", message: "No changes detected." };
    }

    const batch = writeBatch(db);

    try {
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error("User not found");
        
        const existingSettings = userDoc.data().settings || {};
        
        const userDataToUpdate: any = { updatedAt: serverTimestamp() };
        if (updateData.displayName) userDataToUpdate.displayName = updateData.displayName;
        if (updateData.phoneNumber) userDataToUpdate.phoneNumber = updateData.phoneNumber;

        if (updateData.sendAssignmentNotifications !== undefined) {
             userDataToUpdate['settings.sendAssignmentNotifications'] = updateData.sendAssignmentNotifications;
        }

        batch.update(userRef, userDataToUpdate);
        
        // If it's a driver being updated, update their name/phone in the drivers collection too
        if (updateData.displayName || updateData.phoneNumber) {
            const driverRef = doc(db, 'drivers', userId);
            const driverDoc = await getDoc(driverRef);

            if (driverDoc.exists()) {
                const driverDataToUpdate: any = {};
                if (updateData.displayName) driverDataToUpdate.name = updateData.displayName;
                if (updateData.phoneNumber) driverDataToUpdate.phoneNumber = updateData.phoneNumber;
                batch.update(driverRef, driverDataToUpdate);
            }
        }

        await batch.commit();
        
        revalidatePath('/settings');
        revalidatePath('/');
        revalidatePath('/admin');
        
        return { type: "success", message: "Profile updated successfully." };

    } catch (error: any) {
        console.error("Failed to update profile:", error);
        return { type: "error", message: `Failed to update profile: ${error.message}` };
    }
}
