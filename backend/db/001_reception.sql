-- New, isolated database only. No reads/writes to current Firebase/IndexedDB data.
BEGIN;

CREATE TABLE IF NOT EXISTS customers (
    id text PRIMARY KEY,
    phone_normalized text NOT NULL UNIQUE,
    passenger_name text NOT NULL DEFAULT '',
    default_address jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_events (
    event_id text PRIMARY KEY,
    source text NOT NULL CHECK (source IN ('WHATSAPP', 'LANDLINE_ICALL', 'MANUAL', 'CUSTOMER_APP')),
    phone text NOT NULL,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    line text,
    payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS ride_counters (
    order_day date PRIMARY KEY,
    value integer NOT NULL CHECK (value > 0)
);

CREATE TABLE IF NOT EXISTS reception_orders (
    id text PRIMARY KEY,
    call_event_id text UNIQUE REFERENCES call_events(event_id),
    order_day date NOT NULL,
    order_number integer NOT NULL CHECK (order_number > 0),
    source text NOT NULL CHECK (source IN ('WHATSAPP', 'LANDLINE_ICALL', 'MANUAL', 'CUSTOMER_APP')),
    reception_pending boolean NOT NULL DEFAULT false,
    status text NOT NULL CHECK (status IN ('pending', 'waiting', 'assigned', 'driver-accepted', 'driver-arriving', 'arrived', 'in-progress', 'completed', 'cancelled')),
    driver_id text,
    shift_id text,
    passenger_name text NOT NULL DEFAULT '',
    passenger_phone text NOT NULL DEFAULT '',
    pickup jsonb NOT NULL,
    legacy_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_day, order_number),
    CHECK (NOT reception_pending OR (driver_id IS NULL AND shift_id IS NULL AND status IN ('pending', 'waiting', 'cancelled')))
);

COMMIT;
