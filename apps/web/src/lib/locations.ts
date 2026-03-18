import YAML from "yaml";
import locationsYaml from "../../content/data/locations.yaml?raw";

export interface Location {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  county: string | null;
  country: string | null;
  postcode: string | null;
  lat: number | null;
  lon: number | null;
}

const locations: Location[] = YAML.parse(locationsYaml) as Location[];

const byName = new Map<string, Location>();
for (const loc of locations) {
  if (loc.name) {
    byName.set(loc.name, loc);
  }
}

export function getLocationByName(name: string): Location | undefined {
  return byName.get(name);
}
