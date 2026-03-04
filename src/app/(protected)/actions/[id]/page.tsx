/* eslint-disable consistent-return */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { BackArrow, Calendar, Phone, Mail, TwoPeople } from '@/svg_components';
import Link from 'next/link';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import { cn } from '@/lib/cn';
import { useSessionUserData } from '@/hooks/useSessionUserData';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ActionDetail {
  id: string;
  title: string;
  description: string | null;
  type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
  dueDate: string;
  isActive: boolean;
  location: string | null;
  eventTime: string | null;
  eventEndTime: string | null;
  locationUrl: string | null;
  callScript: string | null;
  phoneNumbers: string[];
  emailSubject: string | null;
  emailBody: string | null;
  emailTargets: string[];
  targetMode?: 'CIVIC' | 'MANUAL' | 'BOTH' | null;
  targetLevel?: 'LOCAL' | 'STATE' | 'FEDERAL' | null;
  targetOffices?: string[];
  manualTargets?: Array<{ name: string; email?: string | null; phone?: string | null }>;
  canvassArea: string | null;
  ecanvasserCampaignId: string | null;
  graphics: string[];
  shareText: string | null;
  campaignId: string;
  campaign: {
    id: string;
    name: string;
    description: string;
    status: string;
    cause: { id: string; name: string; icon: string | null; color: string | null };
    org: { id: string; name: string; logoUrl: string | null };
  };
  _count: { participants: number };
  participants?: Array<{ willAttend: boolean; attended: boolean; completedAt: string | null }>;
}

interface RepresentativeInfo {
  name: string;
  office: string;
  party?: string;
  phones: string[];
  urls: string[];
  emails: string[];
  photoUrl?: string;
}

const typeConfig = {
  EVENT: { icon: Calendar, label: 'Event', color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  PHONE: { icon: Phone, label: 'Call in Support', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  EMAIL: { icon: Mail, label: 'Email in Support', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  CANVASS: { icon: TwoPeople, label: 'Canvass', color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
};

const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-script';
const ZIP_CODE_REGEX = /\b\d{5}(?:-\d{4})?\b/;
const REP_CACHE_KEY = 'civic-rep-cache';
const REP_CACHE_VERSION = 2;
const REP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface RepCache {
  version: number;
  address: string;
  officials: RepresentativeInfo[];
  timestamp: number;
}

function getCachedReps(address: string): RepresentativeInfo[] | null {
  try {
    const raw = sessionStorage.getItem(REP_CACHE_KEY);
    if (!raw) return null;
    const cache: RepCache = JSON.parse(raw);
    if (cache.version !== REP_CACHE_VERSION) return null;
    if (cache.address !== address) return null;
    if (Date.now() - cache.timestamp > REP_CACHE_TTL) return null;
    return cache.officials;
  } catch {
    return null;
  }
}

function setCachedReps(address: string, officials: RepresentativeInfo[]) {
  try {
    const cache: RepCache = { version: REP_CACHE_VERSION, address, officials, timestamp: Date.now() };
    sessionStorage.setItem(REP_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota exceeded — non-critical */
  }
}

const normalizeAddress = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (library: 'places') => Promise<{
          PlaceAutocompleteElement: new (options?: {
            componentRestrictions?: { country: string | string[] };
            types?: string[];
          }) => HTMLElement;
        }>;
        places?: {
          PlaceAutocompleteElement: new (options?: {
            componentRestrictions?: { country: string | string[] };
            types?: string[];
          }) => HTMLElement;
        };
      };
    };
  }
}

export default function ActionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const actionId = params.id as string;
  const [userData] = useSessionUserData();

  const [showRepLookup, setShowRepLookup] = useState(false);
  const [zipCode, setZipCode] = useState('');
  const [cityName, setCityName] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [formattedLookupAddress, setFormattedLookupAddress] = useState('');
  const [repInfo, setRepInfo] = useState<RepresentativeInfo[] | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null);
  const [selectedRepEmails, setSelectedRepEmails] = useState<string[]>([]);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [emailSubjectDraft, setEmailSubjectDraft] = useState('');
  const [emailBodyDraft, setEmailBodyDraft] = useState('');
  const placeAutocompleteContainerRef = useRef<HTMLDivElement>(null);
  const placeAutocompleteElementRef = useRef<(HTMLElement & { value?: string }) | null>(null);
  const autocompleteInitializedRef = useRef(false);
  const autoLookupAttemptedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (userData?.zipCode && !zipCode) setZipCode(userData.zipCode);
    const userCity = (userData as { city?: string } | undefined)?.city;
    if (userCity && !cityName) setCityName(userCity);
    if ((userData as { state?: string } | undefined)?.state && !stateCode) {
      setStateCode((userData as { state?: string }).state || '');
    }
    if (userData?.streetAddress && !streetAddress) setStreetAddress(userData.streetAddress);
  }, [cityName, stateCode, streetAddress, userData, userData?.streetAddress, userData?.zipCode, zipCode]);

  useEffect(() => {
    if (!showRepLookup || !isEditingAddress || autocompleteInitializedRef.current) return;
    setAutocompleteError(null);

    const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!mapsApiKey) {
      setAutocompleteError('Google Maps API key is missing.');
      console.error('[civic-autocomplete] Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY');
      return;
    }

    const logAutocomplete = (message: string, meta?: Record<string, unknown>) => {
      // Keep this lightweight in prod but verbose in dev.
      // eslint-disable-next-line no-console
      console.info('[civic-autocomplete]', message, meta || {});
    };

    type ImportLibFn = NonNullable<NonNullable<NonNullable<typeof window.google>['maps']>['importLibrary']>;
    const waitForImportLibrary = (): Promise<ImportLibFn> =>
      new Promise((resolve, reject) => {
        let elapsed = 0;
        const interval = 100;
        const maxWait = 10_000;
        const check = () => {
          if (typeof window.google?.maps?.importLibrary === 'function') {
            resolve(window.google.maps.importLibrary);
            return;
          }
          elapsed += interval;
          if (elapsed >= maxWait) {
            reject(new Error('google.maps.importLibrary not available after 10 s'));
            return;
          }
          setTimeout(check, interval);
        };
        check();
      });

    const initializeAutocomplete = async () => {
      const container = placeAutocompleteContainerRef.current;
      if (!container) {
        setAutocompleteError('Address field container was not found.');
        logAutocomplete('Container missing');
        return;
      }
      let placeAutocompleteCtor = window.google?.maps?.places?.PlaceAutocompleteElement;
      if (!placeAutocompleteCtor) {
        try {
          const importLib = await waitForImportLibrary();
          const placesLib = await importLib('places');
          placeAutocompleteCtor = placesLib.PlaceAutocompleteElement;
          logAutocomplete('Loaded places via importLibrary');
        } catch (error) {
          setAutocompleteError('Failed to import Google Places library.');
          logAutocomplete('importLibrary failed', { error: String(error) });
          return;
        }
      }
      if (!placeAutocompleteCtor) {
        setAutocompleteError('PlaceAutocompleteElement is unavailable in Google Maps script.');
        logAutocomplete('Ctor missing', {
          hasGoogle: Boolean(window.google),
          hasMaps: Boolean(window.google?.maps),
          hasPlaces: Boolean(window.google?.maps?.places),
        });
        return;
      }
      if (autocompleteInitializedRef.current) return;

      const PlaceAutocompleteCtor = placeAutocompleteCtor;
      const placeAutocompleteElement = new PlaceAutocompleteCtor({
        componentRestrictions: { country: 'us' },
        types: ['address'],
      });
      const initialAddress = streetAddress.trim();
      placeAutocompleteElement.setAttribute('placeholder', initialAddress || 'Search for your street address');
      if (initialAddress) {
        placeAutocompleteElement.setAttribute('value', initialAddress);
        (placeAutocompleteElement as unknown as HTMLInputElement).value = initialAddress;
      }
      placeAutocompleteElement.className = 'block w-full';
      placeAutocompleteElement.setAttribute('style', 'width: 100%;');

      const handlePlaceSelect = async (event: Event) => {
        logAutocomplete('Place select event fired');
        const prediction = (event as Event & { placePrediction?: { toPlace?: () => unknown; text?: unknown } })
          .placePrediction;
        const place =
          typeof prediction?.toPlace === 'function'
            ? (prediction.toPlace() as {
                fetchFields?: (request: { fields: string[] }) => Promise<void>;
                formattedAddress?: string;
                addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
              })
            : null;

        if (!place) return;
        if (typeof place.fetchFields === 'function') {
          await place.fetchFields({ fields: ['formattedAddress', 'addressComponents'] });
        }

        const components = Array.isArray(place.addressComponents) ? place.addressComponents : [];
        const postalCode = components.find((component) => component.types?.includes('postal_code'))?.longText;
        const locality =
          components.find((component) => component.types?.includes('locality'))?.longText ||
          components.find((component) => component.types?.includes('postal_town'))?.longText ||
          components.find((component) => component.types?.includes('sublocality'))?.longText ||
          components.find((component) => component.types?.includes('sublocality_level_1'))?.longText ||
          components.find((component) => component.types?.includes('neighborhood'))?.longText;
        const administrativeArea = components.find(
          (component) => component.types?.includes('administrative_area_level_1'),
        );
        const streetNumber = components.find((component) => component.types?.includes('street_number'))?.longText;
        const route = components.find((component) => component.types?.includes('route'))?.longText;
        const formattedAddress = place.formattedAddress || '';
        const predictionText =
          prediction?.text && typeof prediction.text === 'object' && 'toString' in prediction.text
            ? String((prediction.text as { toString: () => string }).toString())
            : '';
        const selectedStreetAddress =
          [streetNumber, route].filter(Boolean).join(' ').trim() ||
          predictionText.split(',')[0]?.trim() ||
          formattedAddress.split(',')[0]?.trim() ||
          '';
        const fallbackZip = (formattedAddress || predictionText).match(ZIP_CODE_REGEX)?.[0];
        const nextZip = postalCode || fallbackZip || '';
        const nextState =
          administrativeArea?.shortText?.toUpperCase() || administrativeArea?.longText?.toUpperCase() || '';

        setFormattedLookupAddress(formattedAddress);
        if (selectedStreetAddress) {
          setStreetAddress(selectedStreetAddress);
        }
        if (locality) {
          setCityName(locality);
        }
        if (nextZip) {
          setZipCode(nextZip);
          if (nextState && nextState.length === 2) {
            setStateCode(nextState);
          }
        }
        logAutocomplete('Place applied', {
          selectedStreetAddress,
          nextZip,
          nextState,
        });

        const saveZip = nextZip || zipCode.trim();
        if (saveZip && /^\d{5}(-\d{4})?$/.test(saveZip)) {
          const saveState = (nextState || stateCode.trim()).toUpperCase();
          const savePayload = {
            zipCode: saveZip.slice(0, 5),
            city: locality || cityName.trim() || null,
            state: saveState && saveState.length === 2 ? saveState : null,
            streetAddress: selectedStreetAddress || streetAddress.trim() || null,
          };
          logAutocomplete('Auto-saving address', savePayload);
          fetch('/api/me/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(savePayload),
          })
            .then((res) => {
              if (res.ok) {
                queryClient.invalidateQueries({ queryKey: ['users'] });
                logAutocomplete('Address auto-saved OK');
              } else {
                logAutocomplete('Address auto-save failed', { status: res.status });
              }
            })
            .catch((err) => {
              logAutocomplete('Address auto-save error', { error: String(err) });
            });
        }
      };

      placeAutocompleteElement.addEventListener('gmp-select', handlePlaceSelect);
      placeAutocompleteElement.addEventListener('gmp-placeselect', handlePlaceSelect);
      container.replaceChildren(placeAutocompleteElement);
      placeAutocompleteElementRef.current = placeAutocompleteElement as HTMLElement & { value?: string };
      autocompleteInitializedRef.current = true;
      logAutocomplete('PlaceAutocompleteElement mounted');
    };

    if (!document.getElementById(GOOGLE_MAPS_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        mapsApiKey,
      )}&libraries=places&loading=async&v=beta`;
      script.async = true;
      script.defer = true;
      script.addEventListener('error', () => {
        setAutocompleteError('Failed to load Google Maps script.');
        logAutocomplete('Script failed to load');
      });
      logAutocomplete('Injecting Google Maps script');
      document.head.appendChild(script);
    }

    void initializeAutocomplete();
  }, [isEditingAddress, showRepLookup, streetAddress]);

  useEffect(() => {
    const normalizedZip = zipCode.trim();
    if (!/^\d{5}(-\d{4})?$/.test(normalizedZip)) return;

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/me/zip-lookup?zip=${encodeURIComponent(normalizedZip.slice(0, 5))}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { state?: string; city?: string };
        if (payload.state) {
          setStateCode(payload.state.toUpperCase());
        }
        if (payload.city && !cityName.trim()) {
          setCityName(payload.city);
        }
      } catch {
        // Non-blocking autofill helper.
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [cityName, zipCode]);

  const {
    data: action,
    isLoading,
    error,
  } = useQuery<ActionDetail>({
    queryKey: ['action', actionId],
    queryFn: async () => {
      const res = await fetch(`/api/actions/${actionId}`);
      if (!res.ok) throw new Error('Failed to fetch action');
      return res.json();
    },
    staleTime: 30_000,
  });

  const participateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/actions/${actionId}/participate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update participation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action', actionId] });
      queryClient.invalidateQueries({ queryKey: ['my-actions'] });
      showToast({ type: 'success', title: 'Participation updated!' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Error', message: err.message });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const body: { targets?: string[]; subject?: string; body?: string } = {
        subject: emailSubjectDraft.trim(),
        body: emailBodyDraft,
      };
      if (action?.targetMode === 'CIVIC' || action?.targetMode === 'BOTH') {
        body.targets = selectedRepEmails;
      }
      const res = await fetch(`/api/actions/${actionId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to send email');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action', actionId] });
      queryClient.invalidateQueries({ queryKey: ['my-actions'] });
      showToast({ type: 'success', title: 'Email sent!' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Error', message: err.message });
    },
  });

  const persistUserLocation = useCallback(async () => {
    if (!zipCode.trim()) {
      throw new Error('Add your zip code first.');
    }
    const locationRes = await fetch('/api/me/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zipCode: zipCode.trim(),
        city: cityName.trim() || null,
        state: stateCode.trim() || null,
        streetAddress: streetAddress.trim() || null,
      }),
    });
    if (!locationRes.ok) {
      const errorData = await locationRes.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save your location');
    }
  }, [cityName, stateCode, streetAddress, zipCode]);

  const fallbackLookupAddress = useCallback(() => {
    const street = streetAddress.trim();
    const city = cityName.trim();
    const state = stateCode.trim().toUpperCase();
    const zip = zipCode.trim().slice(0, 5);
    if (!street || !state || !/^\d{5}$/.test(zip)) return '';
    return [street, city, `${state} ${zip}`].filter(Boolean).join(', ');
  }, [cityName, stateCode, streetAddress, zipCode]);

  const fetchRepresentatives = useCallback(
    async (persistLocationFirst = false, skipCache = false) => {
      setRepError(null);
      setRepLoading(true);
      console.info('[rep-lookup] Starting representative lookup', { persistLocationFirst, skipCache });
      try {
        if (persistLocationFirst) {
          await persistUserLocation();
          void queryClient.invalidateQueries({ queryKey: ['users'] });
        }
        let resolvedCity = cityName.trim();
        let resolvedState = stateCode.trim();
        const resolvedZip = zipCode.trim().slice(0, 5);
        const resolvedStreet = streetAddress.trim();

        if ((!resolvedCity || !resolvedState) && /^\d{5}$/.test(resolvedZip)) {
          const zipLookupRes = await fetch(`/api/me/zip-lookup?zip=${encodeURIComponent(resolvedZip)}`);
          if (zipLookupRes.ok) {
            const zipPayload = (await zipLookupRes.json()) as { city?: string; state?: string };
            if (!resolvedCity && zipPayload.city) {
              resolvedCity = zipPayload.city;
              setCityName(zipPayload.city);
            }
            if (!resolvedState && zipPayload.state) {
              resolvedState = zipPayload.state.toUpperCase();
              setStateCode(zipPayload.state.toUpperCase());
            }
          }
        }

        const googleSource = formattedLookupAddress.trim();
        const address = googleSource
          ? normalizeAddress(googleSource)
          : resolvedStreet && resolvedState && /^\d{5}$/.test(resolvedZip)
          ? normalizeAddress(
              [resolvedStreet, resolvedCity, `${resolvedState.toUpperCase()} ${resolvedZip}`]
                .filter(Boolean)
                .join(', '),
            )
          : '';

        console.info('[rep-lookup] Resolved address', {
          address,
          googleSource,
          resolvedStreet,
          resolvedCity,
          resolvedState,
          resolvedZip,
        });

        if (!address || !/\d+\s+\S+/.test(address)) {
          throw new Error('Add a full address (street, city, state, zip) before lookup.');
        }

        if (!persistLocationFirst && !skipCache) {
          const cached = getCachedReps(address);
          if (cached) {
            console.info('[rep-lookup] Using cached representatives', { count: cached.length, address });
            setRepInfo(cached);
            return;
          }
        }

        const res = await fetch(`/api/civic/representatives?address=${encodeURIComponent(address)}`);
        console.info('[rep-lookup] API response', { status: res.status, ok: res.ok });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error('[rep-lookup] API error', errorData);
          const detailMessage =
            (errorData?.details?.error?.message as string | undefined) ||
            (typeof errorData?.details === 'string' ? errorData.details : undefined);
          throw new Error(detailMessage || errorData.error || 'Failed to fetch representatives');
        }
        const data = await res.json();
        const officials = data.officials || [];
        console.info('[rep-lookup] Found representatives', {
          count: officials.length,
          normalizedAddress: data.normalizedAddress,
        });
        setCachedReps(address, officials);
        setRepInfo(officials);

        fetch('/api/me/representatives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ representatives: officials, address }),
        }).catch(() => {});
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch representatives';
        console.error('[rep-lookup] Error', message);
        setRepError(message);
      } finally {
        setRepLoading(false);
      }
    },
    [
      cityName,
      fallbackLookupAddress,
      formattedLookupAddress,
      persistUserLocation,
      queryClient,
      stateCode,
      streetAddress,
      zipCode,
    ],
  );

  const saveAddressOnly = useCallback(async () => {
    setRepError(null);
    if (!zipCode.trim()) {
      setRepError('Add your zip code before saving your address.');
      return;
    }
    try {
      await persistUserLocation();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsEditingAddress(false);
      showToast({ type: 'success', title: 'Address updated' });
    } catch (err) {
      setRepError(err instanceof Error ? err.message : 'Failed to save your location');
    }
  }, [persistUserLocation, queryClient, showToast, zipCode]);

  const filteredRepInfo = (() => {
    if (!repInfo || !action) return null;
    const { targetLevel } = action;
    const targetOffices = (action.targetOffices || []).map((office) => office.toLowerCase().trim()).filter(Boolean);

    const getLevel = (officeName: string) => {
      const normalized = officeName.toLowerCase();
      if (
        normalized.startsWith('state ') ||
        normalized.includes('state senator') ||
        normalized.includes('state representative') ||
        normalized.includes('governor') ||
        normalized.includes('attorney general') ||
        normalized.includes('secretary of state') ||
        normalized.includes('treasurer') ||
        normalized.includes('comptroller')
      ) {
        return 'STATE';
      }
      if (
        normalized.includes('united states') ||
        normalized.includes('u.s.') ||
        normalized.includes('us senate') ||
        normalized.includes('senate') ||
        normalized.includes('house of representatives') ||
        normalized.includes('congress') ||
        normalized.includes('president') ||
        normalized.includes('vice president')
      ) {
        return 'FEDERAL';
      }
      return 'LOCAL';
    };

    const filtered = repInfo.filter((rep) => {
      if (targetLevel && getLevel(rep.office) !== targetLevel) return false;
      if (!targetOffices.length) return true;
      const officeName = rep.office.toLowerCase();
      const repName = rep.name.toLowerCase();
      return targetOffices.some((filter) => officeName.includes(filter) || repName.includes(filter));
    });

    if (filtered.length === 0 && repInfo.length > 0) {
      console.info('[rep-lookup] Target filter removed all reps — showing all instead', {
        targetLevel,
        targetOffices,
        reps: repInfo.map((r) => ({ name: r.name, office: r.office, level: getLevel(r.office) })),
      });
      return repInfo;
    }

    return filtered;
  })();

  const civicEmailTargets = (() => {
    if (!filteredRepInfo) return [];
    const emails = filteredRepInfo.map((rep) => rep.emails?.[0]).filter((email): email is string => Boolean(email));
    return Array.from(new Set(emails.map((email) => email.trim()).filter(Boolean)));
  })();

  useEffect(() => {
    if (action?.type !== 'EMAIL' || (action?.targetMode !== 'CIVIC' && action?.targetMode !== 'BOTH')) return;
    if (!civicEmailTargets.length) return;
    if (selectedRepEmails.length === 0) {
      setSelectedRepEmails(civicEmailTargets);
    }
  }, [action?.targetMode, action?.type, civicEmailTargets, selectedRepEmails.length]);

  useEffect(() => {
    if (action?.type !== 'EMAIL') return;
    setEmailSubjectDraft(action.emailSubject || '');
    setEmailBodyDraft(action.emailBody || '');
  }, [action?.emailBody, action?.emailSubject, action?.id, action?.type]);

  useEffect(() => {
    if (!action) return;
    const requiresRepresentativeLookup =
      action.type === 'PHONE' ||
      (action.type === 'EMAIL' && (action.targetMode === 'CIVIC' || action.targetMode === 'BOTH'));
    if (!requiresRepresentativeLookup) return;
    setShowRepLookup(true);
  }, [action]);

  useEffect(() => {
    if (!action || repLoading || repInfo) return;
    const requiresRepresentativeLookup =
      action.type === 'PHONE' ||
      (action.type === 'EMAIL' && (action.targetMode === 'CIVIC' || action.targetMode === 'BOTH'));
    if (!requiresRepresentativeLookup) return;

    const cached = userData?.cachedRepresentatives as RepresentativeInfo[] | null | undefined;
    if (Array.isArray(cached) && cached.length > 0) {
      setRepInfo(cached);
      return;
    }

    if (!zipCode.trim()) return;
    if (!streetAddress.trim() && !stateCode.trim()) return;
    const key = `${action.id}:${streetAddress.trim()}:${stateCode.trim()}:${zipCode.trim()}`;
    if (autoLookupAttemptedKeyRef.current === key) return;
    autoLookupAttemptedKeyRef.current = key;
    void fetchRepresentatives(false);
  }, [action, fetchRepresentatives, repInfo, repLoading, stateCode, streetAddress, userData, zipCode]);

  useEffect(() => {
    if (!showRepLookup) return;
    if (streetAddress.trim() || zipCode.trim()) {
      setIsEditingAddress(false);
      return;
    }
    setIsEditingAddress(true);
  }, [showRepLookup, streetAddress, zipCode]);

  useEffect(() => {
    if (isEditingAddress) return;
    autocompleteInitializedRef.current = false;
    placeAutocompleteElementRef.current = null;
    setAutocompleteError(null);
  }, [isEditingAddress]);

  useEffect(() => {
    if (!showRepLookup || !isEditingAddress) return;
    const element = placeAutocompleteElementRef.current;
    if (!element) return;
    const nextAddress = streetAddress.trim();
    if (!nextAddress) return;
    element.setAttribute('value', nextAddress);
    element.setAttribute('placeholder', nextAddress);
    element.value = nextAddress;
  }, [isEditingAddress, showRepLookup, streetAddress]);

  if (isLoading) {
    return (
      <ResponsiveContainer>
        <GenericLoading />
      </ResponsiveContainer>
    );
  }

  if (error || !action) {
    return (
      <ResponsiveContainer>
        <div className="py-12 text-center">
          <h2 className="mb-2 text-xl font-bold">Action Not Found</h2>
          <p className="mb-4 text-muted-foreground">This action doesn&apos;t exist or has been removed.</p>
          <Button onPress={() => router.push('/my-actions')}>Back to My Actions</Button>
        </div>
      </ResponsiveContainer>
    );
  }

  const config = typeConfig[action.type];
  const Icon = config.icon;
  const dueDate = new Date(action.dueDate);
  const isPastDue = isPast(dueDate) && !isToday(dueDate);
  const userParticipation = action.participants?.[0];
  const hasRSVPd = userParticipation?.willAttend;
  const hasCompleted = userParticipation?.attended;
  const hasSpecificDueTime = dueDate.getHours() !== 23 || dueDate.getMinutes() !== 59;

  const getDateLabel = () => {
    if (isToday(dueDate)) return 'Today';
    if (isTomorrow(dueDate)) return 'Tomorrow';
    return format(dueDate, 'EEEE, MMMM d, yyyy');
  };
  const getDueDateTimeLabel = () => {
    const hasSpecificTime = dueDate.getHours() !== 23 || dueDate.getMinutes() !== 59;
    return hasSpecificTime
      ? `${format(dueDate, 'EEEE, MMMM d, yyyy')} at ${format(dueDate, 'h:mm a')}`
      : format(dueDate, 'EEEE, MMMM d, yyyy');
  };

  const manualEmailTargets =
    action?.targetMode === 'MANUAL' || action?.targetMode === 'BOTH'
      ? (action.manualTargets || [])
          .map((target) => target.email?.trim())
          .filter((target): target is string => Boolean(target))
      : [];

  const hasEmailTargets =
    action?.type === 'EMAIL' &&
    (action.targetMode === 'CIVIC'
      ? selectedRepEmails.length > 0
      : action.targetMode === 'MANUAL'
      ? manualEmailTargets.length > 0
      : action.targetMode === 'BOTH'
      ? manualEmailTargets.length > 0 || selectedRepEmails.length > 0
      : action.emailTargets?.length);

  const sharePayload = (() => {
    const text = action.shareText?.trim();
    const url = action.graphics?.[0];
    if (!text && !url) return null;
    return { text, url };
  })();

  const handleShare = async () => {
    if (!sharePayload) return;
    if (navigator.share) {
      await navigator.share({ text: sharePayload.text || undefined, url: sharePayload.url || undefined });
      return;
    }
    if (sharePayload.text) {
      await navigator.clipboard.writeText(sharePayload.text);
      showToast({ type: 'success', title: 'Copied to clipboard' });
    }
  };

  return (
    <ResponsiveContainer>
      <div className="space-y-6 py-4">
        {/* Back navigation */}
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <BackArrow className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className={cn('rounded-lg border border-border bg-card p-6', isPastDue && 'opacity-60')}>
          <div className="mb-4 flex items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-full', config.bgColor)}>
              <Icon className={cn('h-5 w-5', config.color)} />
            </div>
            <div>
              <span className="text-xs font-medium uppercase text-muted-foreground">{config.label}</span>
              <h1 className="text-xl font-bold">{action.title}</h1>
            </div>
          </div>

          {/* Date badge */}
          <div className="mb-4 flex items-center gap-3">
            <span
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium',
                isToday(dueDate)
                  ? 'bg-red-500/10 text-red-500'
                  : isTomorrow(dueDate)
                  ? 'bg-yellow-500/10 text-yellow-500'
                  : 'bg-muted text-muted-foreground',
              )}>
              {getDateLabel()}
            </span>
            {action.eventTime && (
              <span className="text-sm text-muted-foreground">
                at {format(new Date(action.eventTime), 'h:mm a')}
                {action.eventEndTime && ` — ${format(new Date(action.eventEndTime), 'h:mm a')}`}
              </span>
            )}
            {!action.eventTime && hasSpecificDueTime && (
              <span className="text-sm text-muted-foreground">Due at {format(dueDate, 'h:mm a')}</span>
            )}
          </div>

          {/* Participants */}
          <p className="mb-4 text-sm text-muted-foreground">
            {action._count.participants} participant{action._count.participants !== 1 ? 's' : ''}
          </p>

          {/* Status */}
          {hasCompleted && action.type !== 'EVENT' && (
            <div className="mb-4 rounded-md bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-500">
              ✓ You completed this action
            </div>
          )}
          {hasRSVPd && action.type === 'EVENT' && (
            <div className="mb-4 rounded-md bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-500">
              You&apos;re RSVP&apos;d
            </div>
          )}
          {hasRSVPd && !hasCompleted && action.type !== 'EVENT' && (
            <div className="mb-4 rounded-md bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-600">
              Committed to complete by {getDueDateTimeLabel()}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {action.type === 'EVENT' ? (
              !hasRSVPd && (
                <Button
                  size="small"
                  onPress={() => participateMutation.mutate({ willAttend: true })}
                  loading={participateMutation.isPending}
                  isDisabled={isPastDue}>
                  RSVP
                </Button>
              )
            ) : !hasCompleted ? (
              !hasRSVPd ? (
                <Button
                  size="small"
                  onPress={() => participateMutation.mutate({ willAttend: true })}
                  loading={participateMutation.isPending}
                  isDisabled={isPastDue}>
                  Commit to this Action
                </Button>
              ) : (
                <Button
                  size="small"
                  onPress={() => participateMutation.mutate({ attended: true })}
                  loading={participateMutation.isPending}>
                  Mark Complete
                </Button>
              )
            ) : null}

            {action.type === 'EMAIL' && hasEmailTargets && !hasCompleted && (
              <Button
                size="small"
                mode="secondary"
                loading={sendEmailMutation.isPending}
                isDisabled={!emailSubjectDraft.trim() || !emailBodyDraft.trim()}
                onPress={() => sendEmailMutation.mutate()}>
                Send Email
              </Button>
            )}

            {hasCompleted && sharePayload && (
              <Button size="small" mode="secondary" onPress={handleShare}>
                Share
              </Button>
            )}
          </div>
        </div>

        {/* Description */}
        {action.description && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Details</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{action.description}</p>
          </div>
        )}

        {/* Graphics */}
        {action.graphics?.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Media</h2>
            <div className="grid gap-3">
              {action.graphics.map((url, i) => (
                <img
                  key={url}
                  src={url}
                  alt={`${action.title} graphic ${i + 1}`}
                  className="w-full rounded-md object-cover"
                />
              ))}
            </div>
          </div>
        )}

        {/* Location (Event / Canvass) */}
        {(action.type === 'EVENT' || action.type === 'CANVASS') && (action.location || action.canvassArea) && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Location</h2>
            <p className="text-sm text-muted-foreground">📍 {action.location || action.canvassArea}</p>
            {action.locationUrl && (
              <a
                href={action.locationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-sky-500 hover:underline">
                View on map →
              </a>
            )}
          </div>
        )}

        {/* Call Script (Phone) */}
        {action.type === 'PHONE' && action.callScript && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Call Script</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{action.callScript}</p>
          </div>
        )}

        {/* Phone numbers */}
        {action.type === 'PHONE' && action.manualTargets?.length ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Call Targets</h2>
            <div className="flex flex-wrap gap-2">
              {action.manualTargets
                .filter((target) => target.phone)
                .map((target) => (
                  <Button
                    key={`${target.name}-${target.phone}`}
                    size="small"
                    mode="secondary"
                    onPress={() => window.open(`tel:${target.phone}`, '_self')}>
                    {target.name ? `${target.name} (${target.phone})` : target.phone}
                  </Button>
                ))}
            </div>
          </div>
        ) : null}

        {action.type === 'PHONE' && action.phoneNumbers?.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Call Targets</h2>
            <div className="flex flex-wrap gap-2">
              {action.phoneNumbers.map((phone) => (
                <Button key={phone} size="small" mode="secondary" onPress={() => window.open(`tel:${phone}`, '_self')}>
                  {phone}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Find Representative (Phone) */}
        {(action.type === 'PHONE' ||
          (action.type === 'EMAIL' && (action.targetMode === 'CIVIC' || action.targetMode === 'BOTH'))) && (
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Your Representatives</h2>
                {repInfo && userData?.repsLookedUpAt && (
                  <p className="text-xs text-muted-foreground">
                    Last updated {format(new Date(userData.repsLookedUpAt as unknown as string), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
              </div>
              <Button
                size="small"
                mode="ghost"
                onPress={() =>
                  setIsEditingAddress((prev) => {
                    const next = !prev;
                    if (next) {
                      setFormattedLookupAddress('');
                      setRepInfo(null);
                      setRepError(null);
                    }
                    return next;
                  })
                }>
                {isEditingAddress ? 'Cancel address edit' : 'Edit address'}
              </Button>
            </div>
            {showRepLookup && (
              <div className="mt-4 space-y-3">
                {!isEditingAddress && (
                  <p className="text-sm text-muted-foreground">
                    {[streetAddress, stateCode, zipCode].filter(Boolean).join(', ') || 'No saved address yet.'}
                  </p>
                )}
                {isEditingAddress && (
                  <>
                    <div className="space-y-1">
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                      <label className="block text-sm text-muted-foreground">Street Address</label>
                      <div
                        ref={placeAutocompleteContainerRef}
                        className="rounded-2xl bg-input pb-2 pr-5 pt-4 ring-1 ring-muted-foreground/40 focus-within:ring-2 focus-within:ring-primary"
                      />
                    </div>
                    {autocompleteError && <p className="text-sm text-red-500">{autocompleteError}</p>}
                    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      <p>
                        <span className="font-medium text-foreground">City:</span> {cityName || '—'}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">State:</span> {stateCode || '—'}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Zip:</span> {zipCode || '—'}
                      </p>
                      {!formattedLookupAddress.trim() && (
                        <p className="mt-2 text-xs text-yellow-600">
                          Select an address suggestion to populate all fields, or keep your saved full address.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="small" onPress={saveAddressOnly}>
                        Save Address
                      </Button>
                      <Button
                        size="small"
                        mode="secondary"
                        onPress={() => fetchRepresentatives(true)}
                        loading={repLoading}
                        isDisabled={!(formattedLookupAddress.trim() || fallbackLookupAddress())}>
                        Save & Find Representatives
                      </Button>
                    </div>
                  </>
                )}
                {repError && <p className="text-sm text-red-500">{repError}</p>}
                {filteredRepInfo && filteredRepInfo.length === 0 && !repLoading && !repError && (
                  <p className="text-sm text-muted-foreground">
                    No representatives found for this address. Try editing your address to make sure it&apos;s complete.
                  </p>
                )}
                {filteredRepInfo &&
                  filteredRepInfo.length > 0 &&
                  (() => {
                    const getRepLevel = (office: string) => {
                      const n = office.toLowerCase();
                      if (
                        n.startsWith('ca state') ||
                        n.startsWith('ca assembly') ||
                        n.includes('state senator') ||
                        n.includes('state representative') ||
                        n.includes('assembly member')
                      )
                        return 'STATE';
                      if (
                        n.includes('u.s.') ||
                        n.includes('united states') ||
                        n.includes('senate') ||
                        n.includes('congress') ||
                        n.includes('representative')
                      )
                        return 'FEDERAL';
                      return 'LOCAL';
                    };
                    const groups: { label: string; level: string; reps: RepresentativeInfo[] }[] = [];
                    const levelOrder = ['FEDERAL', 'STATE', 'LOCAL'] as const;
                    const levelLabels: Record<string, string> = { FEDERAL: 'Federal', STATE: 'State', LOCAL: 'Local' };
                    for (const level of levelOrder) {
                      const reps = filteredRepInfo.filter((r) => getRepLevel(r.office) === level);
                      if (reps.length) groups.push({ label: levelLabels[level], level, reps });
                    }
                    return (
                      <div className="space-y-5">
                        {groups.map((group) => (
                          <div key={group.level}>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {group.label}
                            </h3>
                            <div className="space-y-3">
                              {group.reps.map((rep) => {
                                const contactUrl = rep.urls.find((u) => /contact/i.test(u));
                                const websiteUrl = rep.urls.find((u) => !/contact/i.test(u)) || rep.urls[0];
                                return (
                                  <div
                                    key={`${rep.office}-${rep.name}`}
                                    className="flex gap-4 rounded-md border border-border bg-muted/20 p-4">
                                    <div className="relative h-16 w-16 flex-shrink-0">
                                      {rep.photoUrl ? (
                                        <img
                                          src={rep.photoUrl}
                                          alt={rep.name}
                                          className="absolute inset-0 h-16 w-16 rounded-full border border-border object-cover opacity-0 transition-opacity duration-300"
                                          onLoad={(e) => {
                                            e.currentTarget.classList.replace('opacity-0', 'opacity-100');
                                            (e.currentTarget.nextElementSibling as HTMLElement | null)?.remove();
                                          }}
                                          onError={(e) => {
                                            e.currentTarget.remove();
                                            const fallback =
                                              e.currentTarget.parentElement?.querySelector('[data-fallback]');
                                            if (fallback)
                                              (fallback as HTMLElement).classList.replace('opacity-0', 'opacity-100');
                                          }}
                                        />
                                      ) : null}
                                      <div
                                        data-fallback=""
                                        className={`flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-bold text-muted-foreground transition-opacity duration-300 ${
                                          rep.photoUrl ? 'opacity-0' : 'opacity-100'
                                        }`}>
                                        {rep.name.charAt(0)}
                                      </div>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-base font-semibold">{rep.name}</p>
                                      <p className="text-sm text-muted-foreground">{rep.office}</p>
                                      {rep.party && <p className="text-xs text-muted-foreground">{rep.party}</p>}
                                      {rep.phones[0] && (
                                        <a
                                          href={`tel:${rep.phones[0]}`}
                                          className="mt-1 inline-block text-sm font-medium text-sky-500 hover:underline">
                                          {rep.phones[0]}
                                        </a>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {action.type === 'PHONE' && rep.phones[0] && (
                                          <Button
                                            size="small"
                                            mode="secondary"
                                            onPress={() => window.open(`tel:${rep.phones[0]}`, '_self')}>
                                            Call
                                          </Button>
                                        )}
                                        {action.type === 'EMAIL' && rep.emails?.[0] && (
                                          <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <input
                                              type="checkbox"
                                              checked={selectedRepEmails.includes(rep.emails[0])}
                                              onChange={(event) => {
                                                const { checked } = event.target;
                                                setSelectedRepEmails((prev) =>
                                                  checked
                                                    ? Array.from(new Set([...prev, rep.emails![0]]))
                                                    : prev.filter((e) => e !== rep.emails![0]),
                                                );
                                              }}
                                            />
                                            {rep.emails[0]}
                                          </label>
                                        )}
                                        {(contactUrl || websiteUrl) && (
                                          <a
                                            href={contactUrl || websiteUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-medium text-sky-500 hover:underline">
                                            Email
                                          </a>
                                        )}
                                        {contactUrl && websiteUrl && websiteUrl !== contactUrl && (
                                          <a
                                            href={websiteUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-muted-foreground hover:underline">
                                            Website
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                {!isEditingAddress && (
                  <Button
                    size="small"
                    mode="ghost"
                    onPress={() => fetchRepresentatives(false, true)}
                    loading={repLoading}>
                    {repInfo ? 'Refresh Representatives' : 'Find Representatives'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Email body (Email) */}
        {action.type === 'EMAIL' && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Review Your Email</h2>
            <div className="space-y-3">
              <TextInput
                label="Subject"
                name="emailSubject"
                value={emailSubjectDraft}
                onChange={setEmailSubjectDraft}
              />
              <Textarea label="Message" value={emailBodyDraft} onChange={setEmailBodyDraft} />
            </div>
          </div>
        )}

        {action.type === 'EMAIL' &&
        (action.targetMode === 'MANUAL' || action.targetMode === 'BOTH') &&
        action.manualTargets?.length ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Email Targets</h2>
            <div className="space-y-2 text-sm text-muted-foreground">
              {action.manualTargets
                .filter((target) => target.email)
                .map((target) => (
                  <p key={`${target.name}-${target.email}`}>
                    {target.name ? `${target.name} — ${target.email}` : target.email}
                  </p>
                ))}
            </div>
          </div>
        ) : null}

        {/* Share section */}
        {hasCompleted && sharePayload && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Share This Action</h2>
            {sharePayload.text && <p className="mb-3 text-sm text-muted-foreground">{sharePayload.text}</p>}
            <Button size="small" mode="secondary" onPress={handleShare}>
              Share
            </Button>
          </div>
        )}

        {/* Campaign link */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">Campaign</h2>
          <Link
            href={`/campaigns/${action.campaign.id}`}
            className="block rounded-md border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40">
            <p className="font-semibold">{action.campaign.name}</p>
            <p className="text-sm text-muted-foreground">{action.campaign.org.name}</p>
            {action.campaign.cause && (
              <span className="mt-1 inline-block rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-500">
                {action.campaign.cause.name}
              </span>
            )}
          </Link>
        </div>
      </div>
    </ResponsiveContainer>
  );
}
