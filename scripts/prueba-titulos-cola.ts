import { cleanQueueTrack, getTrackDisplayTitle, getTrackDisplayArtist, needsTitleRepair, applyTrackMetadata } from '../src/utils/queueTracks';
import { Track } from '../src/types';

const base = (title: string, artist = ''): Track => ({
  id: 'dQw4w9WgXcQ',
  title,
  artist,
  thumbnail: '',
  duration: '3:45'
});

const cases: Track[] = [
  base('4:04', 'Artista'),
  base('4:04'),
  base('Canción de la lista'),
  base('Canción recomendada'),
  base('Dr. Dre - Still D.R.E.'),
  base('Queen - Bohemian Rhapsody', 'Queen Official'),
  base('Bohemian Rhapsody - Remastered', 'Queen'),
  base(''),
  base('Artista'),
];

for (const c of cases) {
  const cleaned = cleanQueueTrack(c);
  console.log(JSON.stringify({
    input: `${c.title} / ${c.artist}`,
    title: cleaned.title,
    artist: cleaned.artist,
    needsRepair: needsTitleRepair(c),
    display: `${getTrackDisplayTitle(c)} / ${getTrackDisplayArtist(c)}`
  }));
}

const repaired = applyTrackMetadata(base('4:04', 'Artista'), {
  id: 'dQw4w9WgXcQ',
  title: 'Rick Astley - Never Gonna Give You Up',
  artist: 'Rick Astley',
  thumbnail: '',
  duration: '3:33'
});
console.log('repaired:', repaired);
