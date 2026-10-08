import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { formatMoney } from './data.js';
import 'leaflet/dist/leaflet.css';

export default function MapCanvas({ homes = [], value, onChange, onSelect, locateRequest = 0 }) {
  const element = useRef(null);
  const map = useRef(null);
  const pin = useRef(null);
  const markerLayer = useRef(null);
  const onSelectRef = useRef(onSelect);
  const initial = useRef(value);
  const markerSignature = homes.map((home) => [home.id, home.price, home.locationPin?.latitude, home.locationPin?.longitude].join(':')).join('|');
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!element.current || map.current) return undefined;
    const start = initial.current || homes.find((home) => home.locationPin)?.locationPin || { latitude: 20.5937, longitude: 78.9629 };
    const hasPin = Boolean(initial.current || homes.some((home) => home.locationPin));
    const instance = L.map(element.current, { scrollWheelZoom: false, zoomControl: true }).setView([start.latitude, start.longitude], hasPin ? (initial.current ? 14 : 12) : 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(instance);
    map.current = instance;
    markerLayer.current = L.layerGroup().addTo(instance);
    if (value) {
      pin.current = L.marker([value.latitude, value.longitude], { draggable: true, icon: L.divIcon({ className: 'owner-map-icon', html: '<span class="owner-map-pin"></span>', iconSize: [24, 32], iconAnchor: [12, 28] }) }).addTo(instance);
      pin.current.on('dragend', () => {
        const point = pin.current.getLatLng();
        onChange?.({ latitude: point.lat, longitude: point.lng });
      });
    }
    if (onChange) {
      instance.on('click', (event) => {
        const next = { latitude: event.latlng.lat, longitude: event.latlng.lng };
        if (pin.current) pin.current.setLatLng(event.latlng);
        else pin.current = L.marker(event.latlng, { draggable: true, icon: L.divIcon({ className: 'owner-map-icon', html: '<span class="owner-map-pin"></span>', iconSize: [24, 32], iconAnchor: [12, 28] }) }).addTo(instance);
        pin.current.off('dragend');
        pin.current.on('dragend', () => {
          const point = pin.current.getLatLng();
          onChange({ latitude: point.lat, longitude: point.lng });
        });
        onChange(next);
      });
    }
    return () => {
      instance.remove();
      map.current = null;
      pin.current = null;
      markerLayer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !markerLayer.current) return;
    markerLayer.current.clearLayers();
    const mappable = homes.filter((home) => home.locationPin);
    const points = [];
    mappable.forEach((home) => {
      const point = [home.locationPin.latitude, home.locationPin.longitude];
      points.push(point);
      const marker = L.marker(point, {
        icon: L.divIcon({ className: 'homiva-map-marker', html: '<span>' + formatMoney(home.price) + '</span>', iconSize: [94, 34], iconAnchor: [47, 34] })
      }).addTo(markerLayer.current);
      marker.on('click', () => onSelectRef.current?.(home));
    });
    if (points.length > 1) map.current.fitBounds(points, { padding: [24, 24], maxZoom: 13 });
    else if (points.length === 1) map.current.setView(points[0], 12);
  }, [markerSignature]);

  useEffect(() => {
    if (!map.current || !locateRequest || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((position) => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      map.current.setView([point.latitude, point.longitude], 15);
      if (pin.current) pin.current.setLatLng([point.latitude, point.longitude]);
      else pin.current = L.marker([point.latitude, point.longitude], { draggable: true, icon: L.divIcon({ className: 'owner-map-icon', html: '<span class="owner-map-pin"></span>', iconSize: [24, 32], iconAnchor: [12, 28] }) }).addTo(map.current);
      onChange?.(point);
    }, () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  }, [locateRequest, onChange]);

  return <div className="leaflet-map" ref={element} aria-label="OpenStreetMap location map" />;
}
