-- Enums
CREATE TYPE user_role AS ENUM ('TENANT','LANDLORD','ADMIN');
CREATE TYPE account_status AS ENUM ('ACTIVE','SUSPENDED','PENDING_VERIFICATION');
CREATE TYPE campus_enum AS ENUM ('MAIN','TOWN');
CREATE TYPE occupancy_enum AS ENUM ('SINGLE','SHARING','DORMITORY');
CREATE TYPE gender_policy_enum AS ENUM ('MALE_ONLY','FEMALE_ONLY','MIXED_SEPARATE_BLOCKS');
CREATE TYPE electricity_enum AS ENUM ('INCLUDED_IN_RENT','PREPAID_ZESCO_SPLIT','TENANT_PAYS');
CREATE TYPE room_type_enum AS ENUM ('SELF_CONTAINED','SHARED_ABLUTION');
CREATE TYPE kitchen_enum AS ENUM ('SHARED_KITCHEN','OUTDOOR_COOKING','NONE');
CREATE TYPE security_level_enum AS ENUM ('NONE','FENCE_ONLY','FENCE_AND_GUARD','24H_GUARD_AND_CCTV');
CREATE TYPE listing_status_enum AS ENUM ('DRAFT','ACTIVE','PAUSED','FULL','REMOVED');
CREATE TYPE request_status_enum AS ENUM ('PENDING','ACCEPTED','DECLINED_BY_LANDLORD','CANCELLED_BY_STUDENT','CANCELLED_BY_LANDLORD','COMPLETED');
CREATE TYPE report_reason_enum AS ENUM ('FAKE_PHOTOS','WRONG_PRICE','PROPERTY_FULL','HARASSMENT','OTHER');
CREATE TYPE report_status_enum AS ENUM ('OPEN','REVIEWED','DISMISSED','ACTIONED');
CREATE TYPE notification_type_enum AS ENUM (
  'REQUEST_CREATED','REQUEST_ACCEPTED','REQUEST_DECLINED',
  'REQUEST_CANCELLED_BY_LANDLORD','REQUEST_CANCELLED_BY_STUDENT',
  'LANDLORD_VERIFIED','REPORT_RECEIVED','ACCOUNT_SUSPENDED','LISTING_HIDDEN'
);

-- Shared helpers
CREATE SEQUENCE request_reference_seq;
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users
CREATE TABLE users (
  id                  SERIAL PRIMARY KEY,
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  phone               TEXT NOT NULL,
  role                user_role NOT NULL,
  account_status      account_status NOT NULL DEFAULT 'ACTIVE',
  student_id          TEXT,
  registration_number TEXT,
  landlord_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_reason    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_lower_uniq ON users (LOWER(email));
CREATE INDEX users_role_idx ON users(role);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- zones
CREATE TABLE zones (
  id                     SERIAL PRIMARY KEY,
  campus                 campus_enum NOT NULL,
  name                   TEXT NOT NULL,
  approx_distance_min_km NUMERIC(5,2),
  approx_distance_max_km NUMERIC(5,2),
  display_order          INT NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX zones_campus_idx ON zones(campus) WHERE is_active;
CREATE TRIGGER zones_set_updated_at BEFORE UPDATE ON zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- listings
CREATE TABLE listings (
  id                    SERIAL PRIMARY KEY,
  landlord_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone_id               INT NOT NULL REFERENCES zones(id),
  campus                campus_enum NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  street_landmark       TEXT NOT NULL,
  distance_to_campus_km NUMERIC(5,2),
  walk_time_minutes     INT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  occupancy             occupancy_enum NOT NULL,
  gender_policy         gender_policy_enum NOT NULL,
  electricity           electricity_enum NOT NULL,
  room_type             room_type_enum NOT NULL,
  kitchen               kitchen_enum NOT NULL,
  security_level        security_level_enum NOT NULL,
  has_solar_backup      BOOLEAN NOT NULL DEFAULT FALSE,
  has_borehole          BOOLEAN NOT NULL DEFAULT FALSE,
  has_overhead_tank     BOOLEAN NOT NULL DEFAULT FALSE,
  free_wifi             BOOLEAN NOT NULL DEFAULT FALSE,
  furnished             BOOLEAN NOT NULL DEFAULT FALSE,
  furnishings_note      TEXT,
  has_curfew            BOOLEAN NOT NULL DEFAULT FALSE,
  curfew_time           TIME,
  total_beds            INT NOT NULL CHECK (total_beds >= 1),
  rent_per_month_zmw    INT NOT NULL CHECK (rent_per_month_zmw > 0),
  deposit_zmw           INT NOT NULL DEFAULT 0,
  status                listing_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX listings_zone_idx ON listings(zone_id) WHERE status IN ('ACTIVE','FULL');
CREATE INDEX listings_landlord_idx ON listings(landlord_id);
CREATE INDEX listings_campus_status_idx ON listings(campus, status);
CREATE TRIGGER listings_set_updated_at BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- listing_photos (1+ photos; the client may send 0)
CREATE TABLE listing_photos (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX listing_photos_listing_idx ON listing_photos(listing_id, sort_order);

-- requests
CREATE TABLE requests (
  id               SERIAL PRIMARY KEY,
  listing_id       INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  tenant_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  move_in_date     DATE NOT NULL,
  duration_months  INT NOT NULL CHECK (duration_months > 0),
  note             TEXT,
  status           request_status_enum NOT NULL DEFAULT 'PENDING',
  reference_code   TEXT UNIQUE,
  accepted_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX requests_listing_status_idx ON requests(listing_id, status);
CREATE INDEX requests_tenant_idx ON requests(tenant_id);
CREATE UNIQUE INDEX requests_one_active_per_pair ON requests(listing_id, tenant_id) WHERE status IN ('PENDING','ACCEPTED');
CREATE TRIGGER requests_set_updated_at BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- reviews (eligibility enforced in the API)
CREATE TABLE reviews (
  id          SERIAL PRIMARY KEY,
  listing_id  INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  tenant_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX reviews_one_per_tenant_listing ON reviews(tenant_id, listing_id);
CREATE INDEX reviews_listing_idx ON reviews(listing_id);

-- saved_listings
CREATE TABLE saved_listings (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, listing_id)
);

-- reports
CREATE TABLE reports (
  id           SERIAL PRIMARY KEY,
  listing_id   INT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       report_reason_enum NOT NULL,
  body         TEXT,
  status       report_status_enum NOT NULL DEFAULT 'OPEN',
  reviewed_by  INT REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX reports_status_idx ON reports(status);

-- notifications
CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type_enum NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link_path   TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX notifications_user_unread_idx ON notifications(user_id) WHERE read_at IS NULL;
