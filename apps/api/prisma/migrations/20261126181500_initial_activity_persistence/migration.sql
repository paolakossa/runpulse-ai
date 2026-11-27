CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "fingerprint" VARCHAR(80) NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "start_time" TIMESTAMPTZ(3),
    "end_time" TIMESTAMPTZ(3),
    "segment_count" INTEGER NOT NULL,
    "track_point_count" INTEGER NOT NULL,
    "total_distance_meters" DOUBLE PRECISION,
    "elapsed_seconds" DOUBLE PRECISION,
    "recorded_duration_seconds" DOUBLE PRECISION,
    "average_elapsed_pace_seconds_per_km" DOUBLE PRECISION,
    "total_elevation_gain_meters" DOUBLE PRECISION,
    "total_elevation_loss_meters" DOUBLE PRECISION,
    "average_heart_rate_bpm" DOUBLE PRECISION,
    "max_heart_rate_bpm" DOUBLE PRECISION,
    "has_overlapping_segments" BOOLEAN NOT NULL,
    "distance_coverage" DOUBLE PRECISION,
    "elevation_coverage" DOUBLE PRECISION,
    "heart_rate_coverage" DOUBLE PRECISION,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "activities_fingerprint_format_check"
      CHECK ("fingerprint" ~ '^v[1-9][0-9]*:[a-f0-9]{64}$'),
    CONSTRAINT "activities_segment_count_positive_check"
      CHECK ("segment_count" > 0),
    CONSTRAINT "activities_track_point_count_positive_check"
      CHECK ("track_point_count" > 0),
    CONSTRAINT "activities_timestamp_order_check"
      CHECK (
        ("start_time" IS NULL AND "end_time" IS NULL) OR
        ("start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "end_time" >= "start_time")
      ),
    CONSTRAINT "activities_numeric_metrics_check"
      CHECK (
        ("total_distance_meters" IS NULL OR
          ("total_distance_meters" >= 0 AND "total_distance_meters" > '-Infinity'::double precision AND "total_distance_meters" < 'Infinity'::double precision)) AND
        ("elapsed_seconds" IS NULL OR
          ("elapsed_seconds" >= 0 AND "elapsed_seconds" > '-Infinity'::double precision AND "elapsed_seconds" < 'Infinity'::double precision)) AND
        ("recorded_duration_seconds" IS NULL OR
          ("recorded_duration_seconds" >= 0 AND "recorded_duration_seconds" > '-Infinity'::double precision AND "recorded_duration_seconds" < 'Infinity'::double precision)) AND
        ("average_elapsed_pace_seconds_per_km" IS NULL OR
          ("average_elapsed_pace_seconds_per_km" > 0 AND "average_elapsed_pace_seconds_per_km" > '-Infinity'::double precision AND "average_elapsed_pace_seconds_per_km" < 'Infinity'::double precision)) AND
        ("total_elevation_gain_meters" IS NULL OR
          ("total_elevation_gain_meters" >= 0 AND "total_elevation_gain_meters" > '-Infinity'::double precision AND "total_elevation_gain_meters" < 'Infinity'::double precision)) AND
        ("total_elevation_loss_meters" IS NULL OR
          ("total_elevation_loss_meters" >= 0 AND "total_elevation_loss_meters" > '-Infinity'::double precision AND "total_elevation_loss_meters" < 'Infinity'::double precision)) AND
        ("average_heart_rate_bpm" IS NULL OR
          ("average_heart_rate_bpm" > 0 AND "average_heart_rate_bpm" > '-Infinity'::double precision AND "average_heart_rate_bpm" < 'Infinity'::double precision)) AND
        ("max_heart_rate_bpm" IS NULL OR
          ("max_heart_rate_bpm" > 0 AND "max_heart_rate_bpm" = trunc("max_heart_rate_bpm") AND "max_heart_rate_bpm" > '-Infinity'::double precision AND "max_heart_rate_bpm" < 'Infinity'::double precision))
      ),
    CONSTRAINT "activities_coverage_range_check"
      CHECK (
        ("distance_coverage" IS NULL OR
          ("distance_coverage" >= 0 AND "distance_coverage" <= 1 AND "distance_coverage" > '-Infinity'::double precision AND "distance_coverage" < 'Infinity'::double precision)) AND
        ("elevation_coverage" IS NULL OR
          ("elevation_coverage" >= 0 AND "elevation_coverage" <= 1 AND "elevation_coverage" > '-Infinity'::double precision AND "elevation_coverage" < 'Infinity'::double precision)) AND
        ("heart_rate_coverage" IS NULL OR
          ("heart_rate_coverage" >= 0 AND "heart_rate_coverage" <= 1 AND "heart_rate_coverage" > '-Infinity'::double precision AND "heart_rate_coverage" < 'Infinity'::double precision))
      )
);

CREATE UNIQUE INDEX "activities_fingerprint_key" ON "activities"("fingerprint");
CREATE INDEX "activities_imported_at_id_idx" ON "activities"("imported_at" DESC, "id" DESC);
