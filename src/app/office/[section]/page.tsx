"use client";
import { useParams } from 'next/navigation';
import { OfficePage } from '@/components/office-page';
export default function Page(){const {section}=useParams<{section:string}>();return <OfficePage key={section} section={section}/>;}
