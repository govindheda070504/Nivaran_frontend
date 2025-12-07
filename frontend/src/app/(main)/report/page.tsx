"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, MapPin, Send, AlertCircle, Loader2, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const THEME = {
  primary: "#19C2E6",
  accent: "#FED801",
  cta: "#FF5A1F",
  text: "#fff",
};

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;
const BACKEND_API = process.env.NEXT_PUBLIC_BACKEND_API;

// ---- Types ----

interface RekognitionLabel {
  Name?: string;
  Confidence?: number;
}

interface DetectionResult {
  status?: string;
  message?: string;
  rekognition_labels?: RekognitionLabel[];
  // allow extra backend fields
  [key: string]: unknown;
}

interface LocationAutocompletePrediction {
  description: string;
}

interface LocationAutocompleteResponse {
  predictions?: LocationAutocompletePrediction[];
}

export default function ReportPage() {
  const router = useRouter();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    description: "",
    severity: "",
    contactName: "",
    contactPhone: "",
    location: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        locationInputRef.current &&
        !locationInputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
        setImageFile(file);
      };
      reader.readAsDataURL(file);
    }
  };

  const getLocationSuggestions = async (input: string) => {
    if (input.length < 3) {
      setLocationSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/location-autocomplete?input=${encodeURIComponent(input)}`
      );
      const data = (await response.json()) as LocationAutocompleteResponse;

      if (data.predictions && Array.isArray(data.predictions)) {
        const suggestions = data.predictions.map(
          (prediction) => prediction.description
        );
        setLocationSuggestions(suggestions);
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error("Error fetching location suggestions:", error);
    }
  };

  const [debouncedLocation, setDebouncedLocation] = useState("");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedLocation(formData.location);
    }, 100);
    return () => clearTimeout(handler);
  }, [formData.location]);

  useEffect(() => {
    if (debouncedLocation.length >= 3) {
      getLocationSuggestions(debouncedLocation);
    } else {
      setLocationSuggestions([]);
      setShowSuggestions(false);
    }
  }, [debouncedLocation]);

  const handleLocationInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData({ ...formData, location: value });
  };

  const handleSuggestionClick = (suggestion: string) => {
    setFormData({ ...formData, location: suggestion });
    setShowSuggestions(false);
    setLocationSuggestions([]);
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      setIsGettingLocation(true);
      toast.info("Fetching your location...");
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;

          try {
            const response = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`
            );
            const data = await response.json();

            let locationString = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

            if (data.results && data.results[0]) {
              locationString = data.results[0].formatted_address;
            }

            setFormData({
              ...formData,
              location: locationString,
            });
            toast.success("Location detected with Google Maps");
          } catch {
            setFormData({
              ...formData,
              location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            });
            toast.success("Location detected");
          } finally {
            setIsGettingLocation(false);
          }
        },
        (error) => {
          toast.error("Unable to fetch location");
          console.error("Geolocation error:", error);
          setIsGettingLocation(false);
        }
      );
    } else {
      toast.error("Geolocation not supported");
      setIsGettingLocation(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!imageFile) {
      toast.error("Please upload an image");
      return;
    }

    if (!formData.location) {
      toast.error("Please provide a location");
      return;
    }

    if (!formData.contactPhone) {
      toast.error("Please provide a contact phone number");
      return;
    }

    if (!formData.severity) {
      toast.error("Please select severity level");
      return;
    }

    toast.info("Submitting report...");
    setIsSubmitting(true);
    setIsAnalyzing(true);
    setDetectionResult(null);

    // Determine latitude / longitude
    let latitude: number | null = null;
    let longitude: number | null = null;

    const coordMatch = formData.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (coordMatch) {
      latitude = parseFloat(coordMatch[1]);
      longitude = parseFloat(coordMatch[2]);
    } else if (GOOGLE_MAPS_API_KEY) {
      try {
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
            formData.location
          )}&key=${GOOGLE_MAPS_API_KEY}`
        );
        const geo = await geoRes.json();
        if (
          geo.results &&
          geo.results[0] &&
          geo.results[0].geometry &&
          geo.results[0].geometry.location
        ) {
          latitude = geo.results[0].geometry.location.lat;
          longitude = geo.results[0].geometry.location.lng;
        }
      } catch (err) {
        console.error("Geocode error", err);
      }
    }

    const toBase64 = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const parts = result.split(",");
          resolve(parts.length > 1 ? parts[1] : parts[0]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    let imageBase64: string;
    try {
      imageBase64 = await toBase64(imageFile);
    } catch (err) {
      console.error("Failed to convert image to base64", err);
      toast.error("Failed to read image file");
      setIsSubmitting(false);
      setIsAnalyzing(false);
      return;
    }

    const payload: Record<string, unknown> = {
      image_base64: imageBase64,
      description: formData.description,
      severity: formData.severity,
      contact_name: formData.contactName,
      contact_phone: formData.contactPhone,
      location: formData.location,
    };
    if (latitude !== null) payload.latitude = latitude;
    if (longitude !== null) payload.longitude = longitude;

    if (!BACKEND_API) {
      toast.error("Backend API not configured (NEXT_PUBLIC_BACKEND_API)");
      setIsSubmitting(false);
      setIsAnalyzing(false);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_API}/report-case`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as DetectionResult;

      setIsAnalyzing(false);

      if (!res.ok) {
        console.error("Backend error", res.status, data);
        toast.error(
          `Failed to submit report: ${
            (data.error as string) ||
            (data.message as string) ||
            res.status
          }`
        );
        setIsSubmitting(false);
        return;
      }

      setDetectionResult(data);

      if (data.status === "invalid_image") {
        toast.error((data.message as string) || "This does not appear to be an animal");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      setSubmitted(true);
      toast.success("Animal detected — case submitted");

      setTimeout(() => {
        router.push("/");
      }, 5000);
    } catch (err) {
      console.error("Submit failed", err);
      toast.error("Network error: failed to submit report");
      setIsSubmitting(false);
      setIsAnalyzing(false);
    }
  };

  return (
    <div
      className="min-h-screen py-12 px-4 sm:px-6 lg:px-8"
      style={{ background: THEME.primary }}
    >
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1
            className="text-3xl sm:text-4xl font-bold mb-4"
            style={{ color: THEME.text }}
          >
            Report a Rescue Case
          </h1>
          <p className="text-lg" style={{ color: "#eaf7ff" }}>
            Help us help them. Upload a photo and provide details about the animal in
            need.
          </p>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold" style={{ color: THEME.primary }}>
              Case Details
            </h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Image Upload */}
              <div className="space-y-2">
                <Label style={{ color: THEME.primary }}>Upload Photo *</Label>
                <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center hover:border-yellow-400 transition-colors">
                  {imagePreview ? (
                    <div className="space-y-4">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="max-h-64 mx-auto rounded-lg"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setImagePreview(null)}
                      >
                        Change Image
                      </Button>
                    </div>
                  ) : (
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageUpload}
                      />
                      <Upload className="w-12 h-12 mx-auto mb-4" />
                      <p className="mb-2">Click to upload or drag and drop</p>
                      <p className="text-sm text-blue-400">
                        PNG, JPG, GIF up to 10MB
                      </p>
                    </label>
                  )}
                </div>
              </div>

              {/* Location */}
              <div className="space-y-2 relative">
                <Label htmlFor="location" style={{ color: THEME.primary }}>
                  Location *
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={locationInputRef}
                      id="location"
                      placeholder="Enter address or location name"
                      value={formData.location}
                      onChange={handleLocationInputChange}
                      onFocus={() => {
                        if (locationSuggestions.length > 0) {
                          setShowSuggestions(true);
                        }
                      }}
                      className="text-black pr-4"
                      required
                    />

                    {showSuggestions && locationSuggestions.length > 0 && (
                      <div
                        ref={suggestionsRef}
                        className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                      >
                        {locationSuggestions.map((suggestion, index) => (
                          <div
                            key={index}
                            className="px-4 py-2 cursor-pointer hover:bg-blue-50 text-black border-b border-gray-100 last:border-b-0"
                            onClick={() => handleSuggestionClick(suggestion)}
                          >
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 flex-shrink-0" />
                              <span className="text-sm">{suggestion}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={getLocation}
                    disabled={isGettingLocation}
                    className="whitespace-nowrap border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-800"
                  >
                    {isGettingLocation ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Navigation className="w-4 h-4 mr-2" />
                    )}
                    {isGettingLocation ? "Detecting..." : "Detect Location"}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">Powered by Google Maps</p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description" style={{ color: THEME.primary }}>
                  Description
                </Label>
                <Textarea
                  id="description"
                  placeholder="Describe the situation, animal behavior, surroundings..."
                  rows={4}
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="text-black"
                />
              </div>

              {/* Severity */}
              <div className="space-y-2">
                <Label htmlFor="severity" style={{ color: THEME.primary }}>
                  Injury Severity *
                </Label>
                <Select
                  value={formData.severity}
                  onValueChange={(value) =>
                    setFormData({ ...formData, severity: value })
                  }
                  required
                >
                  <SelectTrigger className="text-black">
                    <SelectValue placeholder="Select severity level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low" className="text-black">
                      Low - Minor issues
                    </SelectItem>
                    <SelectItem value="Medium" className="text-black">
                      Medium - Needs attention
                    </SelectItem>
                    <SelectItem value="High" className="text-black">
                      High - Urgent care needed
                    </SelectItem>
                    <SelectItem value="Critical" className="text-black">
                      Critical - Life-threatening
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contactName" style={{ color: THEME.primary }}>
                    Your Name
                  </Label>
                  <Input
                    id="contactName"
                    placeholder="Name"
                    value={formData.contactName}
                    onChange={(e) =>
                      setFormData({ ...formData, contactName: e.target.value })
                    }
                    className="text-black"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone" style={{ color: THEME.primary }}>
                    Phone Number *
                  </Label>
                  <Input
                    id="contactPhone"
                    type="tel"
                    placeholder="+91 9278456790"
                    value={formData.contactPhone}
                    onChange={(e) =>
                      setFormData({ ...formData, contactPhone: e.target.value })
                    }
                    className="text-black"
                    required
                  />
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex gap-4">
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={isSubmitting || submitted}
                  style={{
                    background: submitted
                      ? "#10B981"
                      : isSubmitting
                      ? "#94A3B8"
                      : THEME.cta,
                    color: THEME.text,
                    cursor:
                      isSubmitting || submitted ? "not-allowed" : "pointer",
                  }}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmitting
                    ? "Submitting..."
                    : submitted
                    ? "Submitted"
                    : "Submit Rescue Report"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.history.back()}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Analyzing / Detection feedback */}
        {isAnalyzing && (
          <Card className="mt-6" style={{ borderColor: THEME.primary }}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-blue-800">
                    AI is analyzing the image…
                  </p>
                  <p className="text-sm text-gray-700">
                    Please wait while we check whether the image contains an
                    animal.
                  </p>
                </div>
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invalid image */}
        {detectionResult && detectionResult.status === "invalid_image" && (
          <Card className="mt-6" style={{ borderColor: "#ef4444" }}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="font-bold text-red-800 text-lg">
                    THIS IS NOT AN ANIMAL
                  </p>
                  <p className="text-sm text-gray-700 mt-1">
                    Our AI did not detect an animal in the uploaded image. Please
                    do not prank the system — only genuine reports help animals.
                  </p>
                  {Array.isArray(detectionResult.rekognition_labels) &&
                  detectionResult.rekognition_labels.length > 0 ? (
                    <div className="mt-3 text-sm text-gray-700">
                      <strong>Top labels returned by AI:</strong>
                      <ul className="list-disc ml-5 mt-1">
                        {detectionResult.rekognition_labels
                          .slice(0, 3)
                          .map((label, i) => (
                            <li key={i}>
                              {label.Name} (
                              {Math.round(label.Confidence ?? 0)}
                              %)
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Animal detected */}
        {detectionResult &&
          detectionResult.status !== "invalid_image" &&
          submitted && (
            <Card className="mt-6" style={{ borderColor: "#10B981" }}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    {Array.isArray(detectionResult.rekognition_labels) &&
                    detectionResult.rekognition_labels.length > 0 ? (
                      (() => {
                        const top = detectionResult.rekognition_labels![0];
                        return (
                          <>
                            <p className="font-bold text-green-800 text-lg">
                              Detected: {top.Name} (
                              {Math.round(Number(top.Confidence ?? 0))}%)
                            </p>
                            <p className="text-sm text-gray-700 mt-1">
                              Our AI detected the above label with high confidence
                              and a case has been created.
                            </p>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <p className="font-semibold text-green-800">
                          Animal detected
                        </p>
                        <p className="text-sm text-gray-700">
                          Our AI detected an animal — creating a case now.
                        </p>
                      </>
                    )}

                    {Array.isArray(detectionResult.rekognition_labels) &&
                      detectionResult.rekognition_labels.length > 1 && (
                        <div className="mt-3 text-sm text-gray-700">
                          <strong>Other top labels:</strong>
                          <ul className="list-disc ml-5 mt-1">
                            {detectionResult.rekognition_labels
                              .slice(1, 4)
                              .map((label, i) => (
                                <li key={i}>
                                  {label.Name} (
                                  {Math.round(label.Confidence ?? 0)}
                                  %)
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}
                  </div>
                  <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                </div>
              </CardContent>
            </Card>
          )}

        {/* Info Card */}
        <Card
          className="mt-6"
          style={{ background: "#eaf7ff", borderColor: THEME.primary }}
        >
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-blue-900">
                  What happens next?
                </p>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Nearby NGOs and volunteers will be notified instantly</li>
                  <li>• You&apos;ll receive updates on the rescue progress</li>
                  <li>• Our AI will prioritize based on urgency level</li>
                  <li>• Your contact details remain private</li>
                  <li>• Location powered by Google Maps for accuracy</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
