export interface Coords { lat: number; lng: number }
export interface WorkLocation {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_metres: number
  allow_remote: boolean
}

function toRad(deg: number) { return deg * Math.PI / 180 }

export function haversineMetres(a: Coords, b: Coords): number {
  const R = 6_371_000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sin2 = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2))
}

export function matchLocation(coords: Coords, locations: WorkLocation[]): WorkLocation | null {
  for (const loc of locations) {
    const dist = haversineMetres(coords, { lat: loc.latitude, lng: loc.longitude })
    if (dist <= loc.radius_metres) return loc
  }
  return null
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    })
  })
}
