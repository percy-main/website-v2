import {
  AdvancedMarker,
  APIProvider,
  Map as GMap,
  InfoWindow,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";
import { useState, type FC, type PropsWithChildren } from "react";

const MAPS_API_KEY = String(import.meta.env.VITE_MAPS_API_KEY ?? "");
const MAPS_MAP_ID = String(import.meta.env.VITE_MAPS_MAP_ID ?? "");

type Props = PropsWithChildren<{
  center: { lat: number; lon: number };
  infoWindow?: {
    header: string;
  };
}>;

const MarkerWithInfoWindow: FC<
  PropsWithChildren<{
    position: google.maps.LatLngLiteral;
    header: string;
  }>
> = ({ position, children }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoWindowShown, setInfoWindowShown] = useState(true);

  const handleMarkerClick = () => {
    setInfoWindowShown((isShown) => !isShown);
  };

  const handleClose = () => {
    setInfoWindowShown(false);
  };

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        onClick={handleMarkerClick}
      />

      {infoWindowShown && (
        <InfoWindow anchor={marker} onClose={handleClose} headerDisabled>
          {children}
        </InfoWindow>
      )}
    </>
  );
};

export const Map: FC<Props> = ({ center, infoWindow, children }) => {
  const position = { lat: center.lat, lng: center.lon };
  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      <GMap
        mapId={MAPS_MAP_ID}
        className="mt-8 h-[24rem] w-full md:h-[48rem]"
        defaultCenter={position}
        defaultZoom={15}
        gestureHandling={"greedy"}
        disableDefaultUI={true}
      >
        {infoWindow && (
          <MarkerWithInfoWindow position={position} header={infoWindow.header}>
            {children}
          </MarkerWithInfoWindow>
        )}
      </GMap>
    </APIProvider>
  );
};
