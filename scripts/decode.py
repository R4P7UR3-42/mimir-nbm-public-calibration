#!/usr/bin/env python3
"""Decode exactly one NOAA NBM daily-MaxT Q95 GRIB message."""
import argparse
import json
import math
from pathlib import Path

import eccodes

PROFILES = {
    "f042": ("noaa_nbm_native_max_t_q95_decode_v1", 42, "24-42"),
    "f066": ("noaa_nbm_native_max_t_q95_f066_decode_v1", 66, "48-66"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--grib", required=True)
    parser.add_argument("--stations", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--run-date", required=True)
    parser.add_argument("--source-profile", choices=PROFILES, default="f042")
    args = parser.parse_args()
    stations = json.loads(Path(args.stations).read_text())
    if len(stations) != 20 or len({row["station_id"] for row in stations}) != 20:
        raise ValueError("frozen station inventory must contain exactly twenty unique stations")
    with Path(args.grib).open("rb") as source:
        handle = eccodes.codes_grib_new_from_file(source)
        if handle is None:
            raise ValueError("GRIB contains no message")
        try:
            identity = {
                "data_date": str(eccodes.codes_get(handle, "dataDate")),
                "data_time": int(eccodes.codes_get(handle, "dataTime")),
                "step_hours": int(eccodes.codes_get(handle, "step")),
                "step_range": str(eccodes.codes_get(handle, "stepRange")),
                "percentile_value": int(eccodes.codes_get(handle, "percentileValue")),
                "short_name": str(eccodes.codes_get(handle, "shortName")),
                "level_type": str(eccodes.codes_get(handle, "typeOfLevel")),
                "level": int(eccodes.codes_get(handle, "level")),
                "grid_type": str(eccodes.codes_get(handle, "gridType")),
                "packing_type": str(eccodes.codes_get(handle, "packingType")),
            }
            expected_date = args.run_date.replace("-", "")
            schema, forecast_hour, step_range = PROFILES[args.source_profile]
            expected = {
                "data_date": expected_date,
                "data_time": 1200,
                "step_hours": forecast_hour,
                "step_range": step_range,
                "percentile_value": 95,
                "short_name": "max_2t",
                "level_type": "heightAboveGround",
                "level": 2,
            }
            if any(identity[key] != value for key, value in expected.items()):
                raise ValueError(f"unexpected GRIB identity: {identity}")
            extra = eccodes.codes_grib_new_from_file(source)
            if extra is not None:
                eccodes.codes_release(extra)
                raise ValueError("range contains multiple GRIB messages")
            values = []
            for station in stations:
                nearest = eccodes.codes_grib_find_nearest(
                    handle,
                    float(station["latitude"]),
                    float(station["longitude"]),
                    is_lsm=False,
                    npoints=1,
                )[0]
                kelvin = float(nearest["value"])
                distance = float(nearest["distance"])
                if not math.isfinite(kelvin) or not math.isfinite(distance) or distance < 0 or distance > 5:
                    raise ValueError(f"invalid grid value for {station['station_id']}")
                values.append(
                    {
                        "station_id": station["station_id"],
                        "grid_latitude": nearest["lat"],
                        "grid_longitude": nearest["lon"],
                        "distance_km": distance,
                        "temperature_kelvin": kelvin,
                    }
                )
        finally:
            eccodes.codes_release(handle)
    output = {"schema": schema, "eccodes_version": eccodes.__version__, **identity, "values": values}
    Path(args.output).write_text(json.dumps(output, separators=(",", ":"), sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
