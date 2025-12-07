"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Navigation } from "lucide-react";
import { toast } from "sonner";

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_STYLE: React.CSSProperties = {
  width: "100%",
  height: "70vh",
  borderRadius: 8,
  overflow: "hidden",
};

// small helper: distance (meters) between two lat/lng using Haversine
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const aHarv = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;
  const c = 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv));
  return R * c;
}

// ✅ Default export: wrapper with Suspense around the component that uses useSearchParams
export default function TrackingPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>Loading tracking map...</div>}>
      <TrackingPageInner />
    </Suspense>
  );
}

// All your existing logic lives here
function TrackingPageInner() {
  const search = useSearchParams();
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement | null>(null);

  const googleMapRef = useRef<google.maps.Map | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const currentMarkerRef = useRef<google.maps.Marker | null>(null);

  // Query params
  const caseId = search?.get("case_id") || "";
  const destLatParam = search?.get("lat");
  const destLngParam = search?.get("lng");
  const ngoLatParam = search?.get("ngo_lat");
  const ngoLngParam = search?.get("ngo_lng");

  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    ngoLatParam && ngoLngParam
      ? { lat: parseFloat(ngoLatParam), lng: parseFloat(ngoLngParam) }
      : null
  );
  const [destination] = useState<{ lat: number; lng: number } | null>(
    destLatParam && destLngParam
      ? { lat: parseFloat(destLatParam), lng: parseFloat(destLngParam) }
      : null
  );

  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distanceText?: string; durationText?: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [closingCase, setClosingCase] = useState(false);

  // live tracking state
  const watchIdRef = useRef<number | null>(null);
  const [liveTracking, setLiveTracking] = useState(false);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteTimestampRef = useRef<number>(0);

  // Load Google Maps script dynamically
  useEffect(() => {
    if (!destination) {
      setError("Destination coordinates are missing. Open this page with ?lat=<lat>&lng=<lng>.");
      return;
    }

    if (
      typeof window !== "undefined" &&
      (window as Window & { google?: typeof google }).google &&
      (window as Window & { google?: typeof google }).google!.maps
    ) {
      setMapReady(true);
      return;
    }

    if (!GOOGLE_KEY) {
      setError("Google Maps API key is not configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).");
      return;
    }

    const id = "google-maps-script";
    if (document.getElementById(id)) {
      const t = setInterval(() => {
        if (
          (window as Window & { google?: typeof google }).google &&
          (window as Window & { google?: typeof google }).google!.maps
        ) {
          clearInterval(t);
          setMapReady(true);
        }
      }, 200);
      return () => clearInterval(t);
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapReady(true);
    script.onerror = () => setError("Failed to load Google Maps script.");
    document.head.appendChild(script);
  }, [destination]);

  // helper to compute route from a given origin
  const computeRouteFrom = useCallback(
    async (usedOrigin: { lat: number; lng: number }) => {
      const g = (window as Window & { google?: typeof google }).google;
      if (!g || !g.maps) {
        setError("Google Maps is not available.");
        return;
      }

      if (!destination) {
        setError("Destination not set.");
        return;
      }

      if (!googleMapRef.current) {
        setError("Map is not initialized yet.");
        return;
      }

      if (!directionsServiceRef.current) {
        directionsServiceRef.current = new g.maps.DirectionsService();
      }
      const service = directionsServiceRef.current;
      if (!service) return;

      if (!directionsRendererRef.current) {
        directionsRendererRef.current = new g.maps.DirectionsRenderer({
          map: googleMapRef.current,
        });
      }
      const renderer = directionsRendererRef.current;
      if (!renderer) return;

      setLoading(true);
      service.route(
        {
          origin: new g.maps.LatLng(usedOrigin.lat, usedOrigin.lng),
          destination: new g.maps.LatLng(destination.lat, destination.lng),
          travelMode: g.maps.TravelMode.DRIVING,
          drivingOptions: {
            departureTime: new Date(),
            trafficModel: "bestguess" as google.maps.TrafficModel,
          },
          provideRouteAlternatives: false,
        },
        (result: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
          setLoading(false);
          if (status === "OK" && result) {
            renderer.setDirections(result);
            try {
              const leg = result.routes[0].legs[0];
              setRouteInfo({
                distanceText: leg.distance?.text,
                durationText: leg.duration?.text,
              });
            } catch {
              setRouteInfo(null);
            }
          } else {
            console.error("Directions request failed:", status, result);
            setError(`Could not compute route: ${status}`);
          }
        }
      );
    },
    [destination]
  );

  // Initialize map and optionally compute initial route
  useEffect(() => {
    if (!mapReady || !destination) return;

    const initialize = async () => {
      // If origin is missing, try to get it once (not watching)
      if (!origin) {
        if ("geolocation" in navigator) {
          try {
            setLoading(true);
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
            );
            const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setOrigin(coords);
            lastPositionRef.current = coords;
            setLoading(false);
          } catch {
            setLoading(false);
          }
        }
      }

      const g = (window as Window & { google?: typeof google }).google;
      if (!g || !g.maps) {
        setError("Google Maps is not available.");
        return;
      }

      const bounds = new g.maps.LatLngBounds();
      if (origin) bounds.extend(new g.maps.LatLng(origin.lat, origin.lng));
      bounds.extend(new g.maps.LatLng(destination.lat, destination.lng));

      if (!googleMapRef.current && mapRef.current) {
        googleMapRef.current = new g.maps.Map(mapRef.current, {
          center: bounds.getCenter(),
          zoom: 13,
        });
      }

      if (googleMapRef.current) {
        googleMapRef.current.fitBounds(bounds, 80);
      }

      if (!directionsRendererRef.current && googleMapRef.current) {
        directionsRendererRef.current = new g.maps.DirectionsRenderer({
          map: googleMapRef.current,
        });
      }
      if (!directionsServiceRef.current) {
        directionsServiceRef.current = new g.maps.DirectionsService();
      }

      if (!currentMarkerRef.current && origin && googleMapRef.current) {
        currentMarkerRef.current = new g.maps.Marker({
          position: new g.maps.LatLng(origin.lat, origin.lng),
          map: googleMapRef.current,
          title: "You (approx.)",
        });
      }

      if (origin) {
        await computeRouteFrom(origin);
      } else if (googleMapRef.current) {
        new g.maps.Marker({
          position: new g.maps.LatLng(destination.lat, destination.lng),
          map: googleMapRef.current,
          title: "Destination",
        });
      }
    };

    void initialize();
  }, [mapReady, destination, origin, computeRouteFrom]);

  // Live tracking: watchPosition start/stop and handler
  useEffect(() => {
    if (!liveTracking) {
      if (watchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not available in this browser.");
      setLiveTracking(false);
      return;
    }

    const success = (pos: GeolocationPosition) => {
      const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const prev = lastPositionRef.current;
      const now = Date.now();

      lastPositionRef.current = newPos;
      setOrigin(newPos);

      const g = (window as Window & { google?: typeof google }).google;
      if (g && g.maps && googleMapRef.current) {
        if (!currentMarkerRef.current) {
          currentMarkerRef.current = new g.maps.Marker({
            position: new g.maps.LatLng(newPos.lat, newPos.lng),
            map: googleMapRef.current,
            title: "You (live)",
          });
        } else {
          currentMarkerRef.current.setPosition(
            new g.maps.LatLng(newPos.lat, newPos.lng)
          );
        }
      }

      const moved = prev ? haversineMeters(prev, newPos) : Infinity;
      const sinceLastRoute = now - (lastRouteTimestampRef.current || 0);
      if (moved > 20 || sinceLastRoute > 10000) {
        lastRouteTimestampRef.current = now;
        if (directionsServiceRef.current && googleMapRef.current) {
          computeRouteFrom(newPos).catch((e) => {
            console.warn("compute route error", e);
          });
        }
      }
    };

    const fail = (err: GeolocationPositionError) => {
      console.warn("watchPosition error", err);
      toast.error("Unable to get live position (permission denied or unavailable).");
      setLiveTracking(false);
    };

    const id = navigator.geolocation.watchPosition(success, fail, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    });
    watchIdRef.current = id;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [liveTracking, computeRouteFrom]);

  const openInGoogleMaps = () => {
    if (!origin || !destination) {
      toast.error("Missing origin or destination coordinates");
      return;
    }
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      originStr
    )}&destination=${encodeURIComponent(destStr)}&travelmode=driving`;
    window.open(url, "_blank");
  };

  const handleCloseCase = async () => {
    if (!caseId) {
      toast.error("No case ID provided");
      return;
    }

    try {
      setClosingCase(true);
      const response = await fetch(`http://127.0.0.1:3000/ngo-cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });

      if (!response.ok) {
        throw new Error("Failed to close case");
      }

      toast.success("Case marked as completed!");
      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    } catch (err) {
      console.error("Error closing case:", err);
      toast.error("Failed to close case. Please try again.");
    } finally {
      setClosingCase(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Button onClick={handleBack} variant="outline">
          Back
        </Button>
        <h2 style={{ margin: 0 }}>
          Track route to rescue {caseId ? ` (Case ${caseId})` : ""}
        </h2>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 16,
        }}
      >
        <div>
          <Card>
            <CardContent>
              <div ref={mapRef} style={MAP_STYLE} />
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Button
                  onClick={() => setLiveTracking((s) => !s)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Navigation />
                  {liveTracking ? "Stop live tracking" : "Start live tracking"}
                </Button>

                <Button
                  onClick={openInGoogleMaps}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Navigation /> Open in Google Maps
                </Button>
              </div>

              {loading && <p style={{ marginTop: 8 }}>Computing best route…</p>}
              {error && (
                <p style={{ marginTop: 8, color: "crimson" }}>
                  <strong>Error:</strong> {error}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardContent>
              <h3 style={{ marginTop: 0 }}>Route info</h3>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <MapPin />
                <div>
                  <div style={{ fontSize: 13, color: "#666" }}>Origin (NGO)</div>
                  <div style={{ fontWeight: 600, color: "#000" }}>
                    {origin
                      ? `${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`
                      : "Unknown"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <MapPin />
                <div>
                  <div style={{ fontSize: 13, color: "#666" }}>
                    Destination (Case)
                  </div>
                  <div style={{ fontWeight: 600, color: "#000" }}>
                    {destination
                      ? `${destination.lat.toFixed(6)}, ${destination.lng.toFixed(6)}`
                      : "Unknown"}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, color: "#666" }}>
                  Estimated distance
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: "#000",
                  }}
                >
                  {routeInfo?.distanceText || "—"}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: "#666" }}>
                  Estimated travel time
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: "#000",
                  }}
                >
                  {routeInfo?.durationText || "—"}
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <Button
                  onClick={handleCloseCase}
                  disabled={closingCase || !caseId}
                  variant="destructive"
                  style={{ width: "100%" }}
                >
                  {closingCase ? "Closing Case..." : "Close Case"}
                </Button>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, color: "#333" }}>
                  Tips:
                  <ul>
                    <li>
                      Use Start live tracking to keep the map and route updating
                      inside this app as the volunteer moves.
                    </li>
                    <li>
                      If you prefer to use the Google Maps app for navigation,
                      open it with &quot;Open in Google Maps&quot; — but note the
                      web app cannot track the volunteer while they use the
                      external app.
                    </li>
                    <li>
                      Live tracking uses high-accuracy GPS; it may consume
                      battery and requires location permission.
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
