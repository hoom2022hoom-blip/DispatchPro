
"use server";

import 'dotenv/config';
import { authorizeLegacyUser } from '@/lib/legacy-admin-authorization';
import { db } from '@/lib/firebase';
import { doc, getDoc, deleteDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { revalidatePath } from 'next/cache';
import type { Message } from '@/lib/types';
import { getThreadIds } from '@/lib/utils';

export async function deleteMessage(messageId: string) {
    const actor = await authorizeLegacyUser();
    if (!actor) return {type:'error',message:'Message authorization required.'};
    try {
        const stored = await getDoc(doc(db, 'messages', messageId));
        if (!stored.exists() || stored.data().senderId !== actor.uid) return {type:'error',message:'Message authorization required.'};
        await deleteDoc(doc(db, 'messages', messageId));
        revalidatePath('/'); // Revalidate the main dispatch page
        revalidatePath('/driver'); // Revalidate the driver page
        return { type: "success", message: "Message deleted." };
    } catch (error: any) {
        console.error("Failed to delete message:", error);
        return { type: "error", message: `Failed to delete message: ${error.message}` };
    }
}

export async function toggleStarMessage(messageId: string, currentStarredStatus: boolean) {
    const actor = await authorizeLegacyUser();
    if (!actor) return {type:'error',message:'Message authorization required.'};
    try {
        const messageRef = doc(db, 'messages', messageId);
        const stored = await getDoc(messageRef);
        if (!stored.exists() || ![stored.data().senderId,stored.data().recipientId].includes(actor.uid)) return {type:'error',message:'Message authorization required.'};
        await updateDoc(messageRef, { isStarred: !currentStarredStatus });
        revalidatePath('/');
        revalidatePath('/driver');
        return { type: "success", message: `Message ${!currentStarredStatus ? 'starred' : 'unstarred'}.` };
    } catch (error: any) {
        console.error("Failed to star message:", error);
        return { type: "error", message: `Failed to update message: ${error.message}` };
    }
}

export async function forwardMessage(message: Message, recipientId: string, senderId: string) {
    const actor = await authorizeLegacyUser();
    if (!actor || senderId !== actor.uid) return {type:'error',message:'Message authorization required.'};
     try {
        const stored = await getDoc(doc(db, 'messages', message.id));
        if (!stored.exists() || ![stored.data().senderId,stored.data().recipientId].includes(actor.uid)) return {type:'error',message:'Message authorization required.'};
        const originalMessage = stored.data() as Message;

        const newMessage: Omit<Message, 'id'> = {
            threadId: getThreadIds(senderId, recipientId),
            recipientId: recipientId,
            senderId: senderId,
            timestamp: serverTimestamp() as any,
            isReadBy: [senderId],
            text: originalMessage.text,
            imageUrl: originalMessage.imageUrl,
            audioUrl: originalMessage.audioUrl,
        };

        await addDoc(collection(db, 'messages'), newMessage);
        
        revalidatePath('/');
        revalidatePath('/driver');
        return { type: "success", message: "Message forwarded." };
    } catch (error: any) {
        console.error("Failed to forward message:", error);
        return { type: "error", message: `Failed to forward message: ${error.message}` };
    }
}
