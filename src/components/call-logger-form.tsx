"use client";
import {enterNextField} from '@/lib/reception-keyboard';
import { v4 as uuidv4 } from 'uuid';

import React, { useEffect, useMemo, useRef, useState } from "react";
import { sourceLabels, type CallSource } from "@/lib/call-events";
import { statusLabels, activeRideStatuses } from "@/lib/ride-status";
import type { Ride, RideStatus } from "@/lib/types";
import type { ApiCustomer, CustomerPlace } from '@/lib/customer-places';
import { findCustomerByPhone } from '@/lib/customer-places';
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, MapPin, Edit, Phone, Car } from "lucide-react";
import { format } from "date-fns";
import { ShiftPicker, type ShiftChoice } from './shift-picker';
import {OfficeOrderDestination} from './office-order-destination';
import type {SuggestedPlace} from './ride-location-editor';
import type {LocationPoint} from './location-point-picker';

const formSchema = z.object({
  source: z.enum(["WHATSAPP", "LANDLINE_ICALL", "MANUAL", "CUSTOMER_APP", "DRIVER_STREET", "OFFICE", "LANDLINE", "EXTERNAL", "BRIDGE"]),
  status: z.enum(["pending", "waiting", "assigned", "driver-accepted", "driver-arriving", "arrived", "in-progress", "completed", "cancelled"]),
  shiftId: z.string(),
  passengerName: z.string().optional(),
  addressStatus: z.enum(['default', 'variable']),
  pickupLocation: z
    .string()
    .min(3, { message: "أدخل عنوان الانطلاق." }),

  dropoffLocation: z.string().optional(),

  stops: z
    .array(
      z.object({
        name: z.string().min(3, { message: "أدخل عنوان التوقف." }),
      })
    )
    .optional(),

  fareMode: z.enum(["OFFICE_MANUAL","DRIVER_MANUAL","GPS_METER"]).default("OFFICE_MANUAL"),
  totalFare: z.union([z.literal(''), z.coerce.number().min(0, { message: "أدخل مبلغًا صحيحًا." }).max(10000000).multipleOf(0.01)]).nullable(),

  passengerPhone: z.string().optional(),

  passengerCount: z.coerce.number().int().min(1).max(50).optional(),

  scheduledTime: z.string().optional(),

  movingFee: z.boolean().default(false),

  notes: z.string().optional(),
});

type CallLoggerFormValues = z.infer<typeof formSchema>;
const emptyCustomers: ApiCustomer[] = [];
const emptyPlaces: CustomerPlace[] = [];

type CallLoggerFormProps = {
  optionalAddress?: boolean;
  loadSuggestedPlaces?: () => Promise<SuggestedPlace[]>;
  initialAddress?: string;
  initialPhone?: string;
  initialName?: string;
  initialSavedAddressId?: string;
  lookupCustomer?: (phone: string) => Promise<{ customer: ApiCustomer | null; places: CustomerPlace[] }>;
  initialSource?: CallSource;
  shifts?: ShiftChoice[];
  customers?: ApiCustomer[];
  customerPlaces?: CustomerPlace[];
  locationTools?: React.ReactNode;
  onCustomerPlaceSelected?: (place: CustomerPlace) => void;
  onCancel?: () => void;
  onQuickCreateCustomer?: (fullName: string, phone: string) => Promise<ApiCustomer>;
  rideToEdit?: Ride | null;

  onAddRide: (
    rideData: Omit<
      Ride,
      "id" | "status" | "driverId" | "createdAt" | "updatedAt" | "isNew"
    > & { status?: RideStatus; driverId?: string | null }
  ) => void | Promise<void>;

  onEditRide: (rideData: Ride) => void | Promise<void>;
};

// Reception's empty-coordinate sentinel is serialized as no GPS by the API.
const emptyCoordinates = () => ({ x: 0, y: 0 });

export function CallLoggerForm({
  optionalAddress = false,
  loadSuggestedPlaces,
  onAddRide,
  onEditRide,
  rideToEdit,
  initialPhone = "",
  initialName = "",
  initialSavedAddressId,
  lookupCustomer,
  initialSource = "MANUAL",
  initialAddress = "",
  shifts = [],
  customers = emptyCustomers, customerPlaces = emptyPlaces, locationTools, onCancel, onQuickCreateCustomer,
}: CallLoggerFormProps) {
  const isEditMode = !!rideToEdit;
  const destinationRequired = false;
  const [pickupPoint,setPickupPoint]=useState<LocationPoint|undefined>(()=>rideToEdit?.latitude!=null&&rideToEdit.longitude!=null?{latitude:rideToEdit.latitude,longitude:rideToEdit.longitude}:undefined);
  const [destinationPoint,setDestinationPoint]=useState<LocationPoint|undefined>(()=>rideToEdit?.dropoff?.coords?{latitude:rideToEdit.dropoff.coords.x,longitude:rideToEdit.dropoff.coords.y}:undefined);
  const requestId = useRef<string>();
  const [matchedCustomer,setMatchedCustomer]=useState<ApiCustomer|null>(null);
  const [selectedCustomerPlace,setSelectedCustomerPlace]=useState<CustomerPlace|null>(null);
  const [lookupPlaces,setLookupPlaces]=useState<CustomerPlace[]>([]);
  const [lookingUp,setLookingUp]=useState(false);
  const availablePlaces=lookupCustomer?lookupPlaces:customerPlaces;
  const [quickName,setQuickName]=useState('');

  const form = useForm<CallLoggerFormValues>({
    resolver: zodResolver(formSchema.extend({
      pickupLocation: z.string().trim().max(500),
      dropoffLocation: destinationRequired ? z.string().trim().min(1, 'يرجى تحديد وجهة الرحلة').max(500) : z.string().trim().max(500).optional(),
    })),

    defaultValues: useMemo(
      () => ({
      source: rideToEdit?.source ?? initialSource,
      status: rideToEdit?.status ?? "pending",
      shiftId: rideToEdit?.shiftId ?? "",
      passengerName: rideToEdit?.passengerName ?? initialName,
      addressStatus: rideToEdit?.addressStatus ?? 'default',
        pickupLocation: rideToEdit?.pickup.name || initialAddress,
        dropoffLocation: rideToEdit?.dropoff?.name || "",
        stops: rideToEdit?.stops?.map((s) => ({ name: s.name })) || [],
        fareMode: rideToEdit?.fareMode??"OFFICE_MANUAL",
        totalFare: rideToEdit?.finalFare ?? (rideToEdit?.totalFare ? rideToEdit.totalFare : ''),
        passengerPhone: rideToEdit ? (rideToEdit.passengerPhone ?? "") : initialPhone,
        passengerCount: rideToEdit?.passengerCount ?? 1,
        movingFee: rideToEdit?.movingFee || false,
        notes: rideToEdit?.notes || "",
        scheduledTime: rideToEdit?.scheduledTime
          ? format(new Date(rideToEdit.scheduledTime), "yyyy-MM-dd'T'HH:mm")
          : "",
      }),
      [rideToEdit, initialPhone, initialSource, initialName, initialAddress]
    ),
  });
  const watchedPhone=form.watch('passengerPhone');
  useEffect(()=>{
    let stopped=false;
    if(lookupCustomer&&matchedCustomer){form.setValue('passengerName','');form.setValue('pickupLocation','');form.setValue('notes','');}
    form.clearErrors('passengerPhone');
    setMatchedCustomer(null);setSelectedCustomerPlace(null);setLookupPlaces([]);
    const apply=(customer:ApiCustomer|null,places:CustomerPlace[])=>{
      if(stopped)return;
      setMatchedCustomer(customer);setLookupPlaces(places);
      if(customer){
        form.setValue('passengerName',customer.fullName);
        const own=places.filter(p=>p.address.customerId===customer.id);
        const place=own.find(p=>p.address.id===initialSavedAddressId)??own.find(p=>p.address.isDefault)??own[0];
        if(place){setSelectedCustomerPlace(place);form.setValue('pickupLocation',place.address.addressText);form.setValue('notes',place.address.notes??'');}
      }
    };
    if(!lookupCustomer){apply(findCustomerByPhone(customers,watchedPhone??'')??null,customerPlaces);return;}
    const number=(watchedPhone??'').replace(/[^\d+]/g,'');
    if(!/^(?:05\d{8}|\+9705\d{8})$/.test(number)){setLookingUp(false);return;}
    setLookingUp(true);
    const timer=setTimeout(()=>{void lookupCustomer(number).then(result=>apply(result.customer,result.places)).catch(()=>{if(!stopped)form.setError('passengerPhone',{message:'تعذر البحث عن العميل؛ أعد المحاولة'});}).finally(()=>{if(!stopped)setLookingUp(false);});},250);
    return()=>{stopped=true;clearTimeout(timer);};
  },[watchedPhone,customers,customerPlaces,form,lookupCustomer,initialSavedAddressId]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "stops",
  });
  useEffect(() => { if (!rideToEdit && initialAddress) form.setValue('pickupLocation', initialAddress); }, [initialAddress, rideToEdit, form]);

  const handleSelectOnFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    e.target.select();
  };

  const submitLock=useRef(false);
  async function onSubmit(values: CallLoggerFormValues) {
    if(lookingUp){form.setError('passengerPhone',{message:'انتظر اكتمال البحث عن العميل'});return;}
    if(submitLock.current)return;submitLock.current=true;
    form.clearErrors("root");
    try {
    const passengerCount = values.passengerCount || 1;
    const shift = shifts.find(item => item.id === values.shiftId);
    const driverId = shift?.driverId ?? (values.shiftId === rideToEdit?.shiftId ? rideToEdit?.driverId : null);
    if (activeRideStatuses.includes(values.status) && !driverId) {
      form.setError('shiftId', { message: 'اختر سائقًا له وردية نشطة لهذه الحالة.' });
      return;
    }

    const calculatedFare = values.totalFare === '' ? null : values.totalFare;
    const scheduledTimeDate = values.scheduledTime ? new Date(values.scheduledTime) : undefined;

    const baseRideData = {
      receptionPending: false,
      ...(!isEditMode ? { id: requestId.current ?? (requestId.current = uuidv4()) } : {}),
      ...(isEditMode || calculatedFare !== null ? {fareMode:isEditMode?values.fareMode:"OFFICE_MANUAL"} : {}),
      totalFare: calculatedFare,
      source: values.source,
      status: values.shiftId && ['pending', 'waiting'].includes(values.status) ? 'assigned' as RideStatus : values.status,
      shiftId: values.status === 'cancelled' ? null : values.shiftId || null,
      driverId: values.status === 'cancelled' ? null : driverId ?? null,
      passengerName: values.passengerName || "",
      addressStatus: values.addressStatus,
      passengerPhone: values.passengerPhone,
      passengerCount,
      movingFee: values.movingFee,
      notes: values.notes,
      scheduledTime: values.scheduledTime
        ? scheduledTimeDate
        : undefined,
    };

    if (isEditMode && rideToEdit) {
      await onEditRide({
        ...rideToEdit,
        ...baseRideData,
        ...(pickupPoint?{latitude:pickupPoint.latitude,longitude:pickupPoint.longitude,locationSource:'MAP_PIN' as const}:{}),

        pickup: {
          ...rideToEdit.pickup,
          name: values.pickupLocation,
        },

        dropoff: values.dropoffLocation
          ? {
              ...(destinationPoint ? {coords:{x:destinationPoint.latitude,y:destinationPoint.longitude}} : {}),
              name: values.dropoffLocation,
            }
          : undefined,

        stops: values.stops?.map((stop, i) => {
          const originalStop = rideToEdit.stops?.[i];

          return {
            name: stop.name,
            coords:
              originalStop?.coords || emptyCoordinates(),
          };
        }),
      });
    } else {
      await onAddRide({
        ...baseRideData,
        ...(matchedCustomer?{customerId:matchedCustomer.id}:{}),
        ...(selectedCustomerPlace?{savedAddressId:selectedCustomerPlace.address.id, addressText:selectedCustomerPlace.address.addressText, neighborhood:selectedCustomerPlace.address.neighborhood, street:selectedCustomerPlace.address.street, latitude:selectedCustomerPlace.address.latitude, longitude:selectedCustomerPlace.address.longitude, locationSource:'SAVED_ADDRESS' as const}:{}),
        ...(pickupPoint?{addressText:values.pickupLocation,latitude:pickupPoint.latitude,longitude:pickupPoint.longitude,locationSource:'MAP_PIN' as const,savedAddressId:null}:{}),

        pickup: {
          name: values.pickupLocation,
          coords: {x:pickupPoint?.latitude??0,y:pickupPoint?.longitude??0},
        },

        dropoff: values.dropoffLocation
          ? {
              name: values.dropoffLocation,
              ...(destinationPoint ? {coords:{x:destinationPoint.latitude,y:destinationPoint.longitude}} : {}),
            }
          : undefined,

        stops: values.stops?.map((stop) => ({
          name: stop.name,
          coords: emptyCoordinates(),
        })),
      });
    }

    form.reset();
    requestId.current = undefined;
    } catch (error) {
      const detail = error instanceof Error && /[\u0600-\u06ff]/.test(error.message) ? error.message : 'تعذر حفظ الطلب';
      form.setError("root", { message: `${detail}. بقيت البيانات في النموذج؛ حاول مجددًا.` });
    } finally {submitLock.current=false;}
  }

  useEffect(() => {
    setPickupPoint(rideToEdit?.latitude!=null&&rideToEdit.longitude!=null?{latitude:rideToEdit.latitude,longitude:rideToEdit.longitude}:undefined);
    setDestinationPoint(rideToEdit?.dropoff?.coords && (rideToEdit.dropoff.coords.x!==0||rideToEdit.dropoff.coords.y!==0)?{latitude:rideToEdit.dropoff.coords.x,longitude:rideToEdit.dropoff.coords.y}:undefined);
    form.reset({
     source: rideToEdit?.source ?? initialSource,
      status: rideToEdit?.status ?? "pending",
      shiftId: rideToEdit?.shiftId ?? "",
      passengerName: rideToEdit?.passengerName ?? initialName,
      addressStatus: rideToEdit?.addressStatus ?? 'default',
      pickupLocation: rideToEdit?.pickup.name || initialAddress,
      dropoffLocation: rideToEdit?.dropoff?.name || "",
      stops:
        rideToEdit?.stops?.map((s) => ({
          name: s.name,
        })) || [],
      fareMode: rideToEdit?.fareMode??"OFFICE_MANUAL",
        totalFare: rideToEdit?.finalFare ?? (rideToEdit?.totalFare ? rideToEdit.totalFare : ''),
      passengerPhone: rideToEdit ? (rideToEdit.passengerPhone ?? "") : initialPhone,
      passengerCount: rideToEdit?.passengerCount ?? 1,
      movingFee: rideToEdit?.movingFee || false,
      notes: rideToEdit?.notes || "",
      scheduledTime: rideToEdit?.scheduledTime
        ? format(
            new Date(rideToEdit.scheduledTime),
            "yyyy-MM-dd'T'HH:mm"
          )
        : "",
    });
  }, [rideToEdit, initialPhone, initialSource, initialName, form]);

  useEffect(()=>{if(!rideToEdit&&initialAddress)form.setValue('pickupLocation',initialAddress);},[initialAddress,rideToEdit,form]);

  return (
    <div
      dir="rtl"
      className="pr-1"
    >
      <div className="mb-3 rounded-lg border bg-muted/40 p-3">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5" />

          <h2 className="text-lg font-bold">
            {isEditMode ? "تعديل الطلب" : "استقبال طلب جديد"}
          </h2>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          مكتب تكسي نابلس والمهندس
        </p>
      </div>

      <p className="mb-3 text-sm">{rideToEdit ? `طلب رقم ${rideToEdit.orderNumber ?? '—'} · ${rideToEdit.orderDay ?? ''}` : 'يُخصص رقم الطلب عند الحفظ'} · {rideToEdit ? format(rideToEdit.createdAt, "dd/MM HH:mm") : "طلب جديد"}</p>
      <Form {...form}>
        <form onKeyDown={enterNextField}
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-3 lg:col-span-3 lg:grid-cols-4">
            <FormItem><FormLabel>الوقت</FormLabel><Input aria-label="وقت الطلب" tabIndex={-1} type="time" value={format(new Date(), 'HH:mm')} readOnly /></FormItem>
            <FormItem><FormLabel>التاريخ</FormLabel><Input aria-label="تاريخ الطلب" tabIndex={-1} type="date" value={format(new Date(), 'yyyy-MM-dd')} readOnly /></FormItem>
            <FormField control={form.control} name="passengerPhone" render={({ field }) => <FormItem><FormLabel>رقم الزبون</FormLabel><FormControl><div className="relative"><Phone className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><Input dir="ltr" className="pr-10 text-left" placeholder="09XXXXXXXX" {...field} onFocus={handleSelectOnFocus} /></div></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="passengerName" render={({ field }) => <FormItem><FormLabel>اسم الزبون</FormLabel><FormControl><Input placeholder="أدخل اسم الزبون" {...field} onFocus={handleSelectOnFocus} /></FormControl><FormMessage /></FormItem>} />
          </div>
          <FormField control={form.control} name="passengerPhone" render={() => <FormItem className="lg:col-span-3">
                {lookingUp&&<p role="status">جارٍ البحث عن العميل…</p>}
                {matchedCustomer&&<div className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">عميل معروف: {matchedCustomer.fullName}{availablePlaces.some(p=>p.address.customerId===matchedCustomer.id)&&<select aria-label="عنوان العميل المحفوظ" className="mt-2 h-10 w-full rounded border bg-white px-2" value={selectedCustomerPlace?.address.id??''} onChange={e=>{const place=availablePlaces.find(p=>p.address.id===e.target.value)??null;setSelectedCustomerPlace(place);if(place){form.setValue('pickupLocation',place.address.addressText);form.setValue('notes',place.address.notes??'');}}}><option value="">اختر عنوانًا محفوظًا</option>{availablePlaces.filter(p=>p.address.customerId===matchedCustomer.id).map(p=><option key={p.address.id} value={p.address.id}>{p.address.label} — {p.address.addressText}</option>)}</select>}</div>}
                {!matchedCustomer&&!lookingUp&&(watchedPhone??'').length>=8&&onQuickCreateCustomer&&<div className="flex gap-2"><Input aria-label="اسم عميل جديد" placeholder="اسم العميل الجديد" value={quickName} onChange={e=>setQuickName(e.target.value)}/><Button type="button" variant="outline" onClick={async()=>{if(!quickName.trim())return;try{const c=await onQuickCreateCustomer(quickName,watchedPhone??'');setMatchedCustomer(c);form.setValue('passengerName',c.fullName);setQuickName('');}catch(e){form.setError('passengerPhone',{message:(e as Error).message});}}}>إنشاء عميل سريع</Button></div>}
              </FormItem>} />
          <FormField control={form.control} name="pickupLocation" render={({ field,fieldState }) => <FormItem className="lg:col-span-2"><FormLabel>من أين تريد الانطلاق؟</FormLabel><OfficeOrderDestination required={false} target="pickup" inputRef={field.ref} onBlur={field.onBlur} invalid={!!fieldState.error} value={field.value} point={pickupPoint} places={loadSuggestedPlaces} onChange={(text,point)=>{field.onChange(text);setPickupPoint(point);setSelectedCustomerPlace(null);}}/><FormMessage /></FormItem>} />
              <FormField control={form.control} name="dropoffLocation" render={({ field, fieldState }) => <FormItem><FormLabel htmlFor="order-destination">إلى أين الوجهة؟ {destinationRequired&&<span className="text-destructive">*</span>}</FormLabel><OfficeOrderDestination routeOrigin={pickupPoint} inputId="order-destination" inputRef={field.ref} onBlur={field.onBlur} required={destinationRequired} invalid={!!fieldState.error} value={field.value??''} point={destinationPoint} places={loadSuggestedPlaces} onChange={(text,point)=>{field.onChange(text);setDestinationPoint(point);}}/><FormMessage /></FormItem>} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-3">
            <FormField control={form.control} name="totalFare" render={({ field }) => <FormItem><FormLabel>السعر (شيكل) · اختياري</FormLabel><FormControl><Input type="number" min="0" step="0.01" {...field} value={field.value ?? ''} onFocus={handleSelectOnFocus} /></FormControl><FormMessage /></FormItem>} /><FormField control={form.control} name="status" render={({ field }) => <FormItem><FormLabel>الحالة</FormLabel><FormControl><span className="flex h-10 items-center rounded-md bg-muted px-3 font-semibold">{statusLabels[field.value]}</span></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name="addressStatus" render={({ field }) => <FormItem><FormLabel>نوع العنوان</FormLabel><FormControl><select className="h-10 w-full rounded-md border bg-background px-2" {...field}><option value="default">ثابت</option><option value="variable">متغير</option></select></FormControl><FormMessage /></FormItem>} />
          </div>
          </div>
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer select-none font-semibold">تفاصيل إضافية</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <FormField control={form.control} name="source" render={({ field }) => <FormItem><FormLabel>مصدر الطلب</FormLabel><FormControl><select className="h-10 w-full rounded-md border bg-background px-2" {...field}>{field.value==='DRIVER_STREET'&&<option value="DRIVER_STREET">راكب أو طلب من الشارع</option>}{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormControl><FormMessage /></FormItem>} />
              <FormField control={form.control} name="scheduledTime" render={({ field }) => <FormItem><FormLabel>الموعد</FormLabel><FormControl><Input type="datetime-local" {...field} /></FormControl><FormMessage /></FormItem>} />
              <FormField control={form.control} name="passengerCount" render={({ field }) => <FormItem><FormLabel>عدد الركاب</FormLabel><FormControl><Input type="number" min="1" {...field} onFocus={handleSelectOnFocus} /></FormControl><FormMessage /></FormItem>} />
              {isEditMode&&<FormField control={form.control} name="fareMode" render={({field})=><FormItem><FormLabel>طريقة التسعير</FormLabel><FormControl><select className="h-11 w-full rounded border bg-white px-3" {...field}><option value="OFFICE_MANUAL">مكتب</option><option value="DRIVER_MANUAL">سائق (حسب الإعدادات)</option><option value="GPS_METER">عداد GPS</option></select></FormControl><FormMessage/></FormItem>}/>}
              {fields.map((item, index) => <FormField key={item.id} control={form.control} name={`stops.${index}.name`} render={({ field }) => <FormItem><FormLabel>توقف إضافي {index + 1}</FormLabel><div className="flex items-center gap-2"><FormControl><Input placeholder="عنوان التوقف" {...field} onFocus={handleSelectOnFocus} /></FormControl><Button type="button" variant="destructive" size="icon" onClick={() => remove(index)}><Trash2 className="h-4 w-4" /></Button></div><FormMessage /></FormItem>} />)}
              <div className="flex items-end"><Button type="button" variant="outline" size="sm" onClick={() => append({ name: "" })}><MapPin className="ml-2 h-4 w-4" />إضافة توقف</Button></div>
              <FormField control={form.control} name="movingFee" render={({ field }) => <FormItem className="flex flex-row-reverse items-center justify-end gap-3 rounded-md border p-3"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="m-0">يتطلب رسومًا إضافية (تُدرج في السعر يدويًا)</FormLabel></FormItem>} />
            </div>
          </details>
          <FormField control={form.control} name="notes" render={({ field }) => <FormItem><FormLabel>الملاحظات</FormLabel><FormControl><Textarea className="min-h-12" placeholder="اختياري" {...field} onFocus={handleSelectOnFocus} /></FormControl><FormMessage /></FormItem>} />
            <p className="text-sm text-muted-foreground">بعد الحفظ، اختر السائق من خانته في الجدول، ثم «إرسال» لتحديد مشاركة الهاتف.</p>
          <div className="sticky bottom-0 z-10 flex gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button
            disabled={form.formState.isSubmitting}
            type="submit"
            className="flex-1 text-base"
            size="lg"
          >
            {isEditMode ? (
              <Edit className="ml-2 h-5 w-5" />
            ) : (
              <Car className="ml-2 h-5 w-5" />
            )}

            {isEditMode
              ? "حفظ تعديل الطلب"
              : form.watch("shiftId") ? "إرسال" : "حفظ الطلب"}
          </Button>
          {onCancel && <Button type="button" variant="outline" size="lg" onClick={onCancel}>إلغاء</Button>}
          </div>

          {form.formState.errors.root && <p role="alert" className="text-destructive">{form.formState.errors.root.message}</p>}
        </form>
      </Form>
    </div>
  );
}
