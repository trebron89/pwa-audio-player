# NPlayer – odtwarzacz audio (PWA) na iPhone'a

Odtwarzacz plików audio zapisanych na iPhonie. Działa offline, bez Maca, bez konta Apple Developer i bez limitu 7 dni.

## Co potrafi

- **Wczytywanie plików lub całego folderu** z aplikacji Pliki (iOS 18.4+). Pliki są kopiowane do pamięci aplikacji i działają offline.
- **Folder → playlista**: po wczytaniu folderu NPlayer proponuje zapisanie go jako osobnej playlisty (nazwa = nazwa folderu).
- **Okładki**: jeśli w folderze jest obraz (JPG, PNG, WebP, HEIC…), można go wybrać jako okładkę. Pliki o nazwach typu `cover`, `folder`, `front`, `okładka` są proponowane jako pierwsze. Okładkę można też wziąć z tagów albo ustawić później z menu playlisty.
- **Tagi**: tytuł, wykonawca, album i okładka z plików MP3 (ID3), M4A/M4B oraz FLAC.
- **Sortowanie wg nazwy pliku lub tytułu z tagu**. Liczba na końcu nazwy jest porównywana jako:
  - **wersja** (domyślnie): 1.2 → 1.9 → 1.10 → 2,
  - **liczba dziesiętna**: 1.10 → 1.2 → 1.9 → 2.
  Tryb zmienia się w Ustawieniach. Playlistę można posortować z jej menu ⋯.
- **Biblioteka w folderach**: utwory są grupowane wg folderu, z którego zostały wczytane. Odtwarzanie z folderu ustawia kolejkę tylko z tego folderu. Pliki wczytane przed wersją 2.1 trafiają do folderu playlisty, do której należą, albo do „Inne pliki” – ponowne wczytanie folderu przypisze je właściwie.
- **Usuwanie**: cały folder usuniesz z menu ⋯ przy folderze w Bibliotece (lub w widoku folderu), playlistę – z menu ⋯ na kafelku w zakładce Playlisty.
- **Zaznaczanie wielu**: przycisk „Zaznacz” w Bibliotece (foldery) i w widoku folderu (utwory). Zaznaczone można usunąć naraz albo – w folderze – dodać do playlisty. Foldery w Bibliotece są zawsze zwinięte, także gdy został tylko jeden.
- **Wyłącznik czasowy**: ikona księżyca w lewym dolnym rogu pełnego odtwarzacza. Czas wybiera się kółkami (godziny / minuty) jak w Minutniku iOS albo szybkim przyciskiem; jest też opcja „Po bieżącym utworze”. Domyślnie wyłączony. Po upływie czasu odtwarzanie zostaje zatrzymane (aplikacja PWA nie może zamknąć samej siebie).
- **Teraz odtwarzane**: przycisk listy w prawym dolnym rogu pełnego odtwarzacza pokazuje bieżącą kolejkę (folder lub playlistę); dotknięcie utworu przełącza na niego.
- Playlisty, zapamiętywanie miejsca przerwania, prędkość odtwarzania, przyciski na ekranie blokady (poprzedni / play-pauza / następny, bez ±10 s), pełnoekranowy odtwarzacz (dotknij mini-odtwarzacza, zamknij przeciągnięciem w dół).
- Kopia zapasowa playlist do pliku JSON i dziennik diagnostyczny.

## Wdrożenie na GitHub Pages (tylko przeglądarka)

1. Rozpakuj `nplayer.zip`.
2. Na github.com utwórz **publiczne** repozytorium, np. `nplayer`.
3. **Add file → Upload files** → przeciągnij **zawartość** folderu (pliki i folder `icons`) → **Commit changes**.
4. **Settings → Pages** → Branch `main`, folder `/ (root)` → **Save**.
5. Po około minucie aplikacja będzie pod adresem `https://TWOJA-NAZWA.github.io/nplayer/`.

Jeśli wcześniej wgrałeś wersję „Odtwarzacz” do tego samego repozytorium, po prostu nadpisz pliki. Biblioteka i playlisty zostaną.

## Na iPhonie

1. Otwórz adres w **Safari**.
2. **Folder** → wybierz folder z albumem lub audiobookiem → zapisz jako playlistę i wybierz okładkę.
3. Udostępnij → **Dodaj do ekranu początkowego**.
4. Ustawienia → „Poproś o trwałą pamięć”.

## Test odtwarzania przy zablokowanym ekranie

1. Wczytaj 2–3 krótkie utwory, odtwórz pierwszy i zablokuj ekran.
2. Po odblokowaniu: Ustawienia → Diagnostyka. „[tło] koniec: …” i zaraz po nim „[tło] gra: …” oznacza, że przejście do następnego utworu działa w tle.
3. Zamknij aplikację w przełączniku aplikacji, otwórz ponownie i naciśnij ▶.

## Ważne

- Wyczyszczenie danych witryn w ustawieniach Safari usuwa kopie plików (oryginały zostają w Plikach).
- Karta Safari i aplikacja z ekranu początkowego mają osobne dane.
- Po aktualizacji plików na GitHubie nowa wersja pojawia się przy kolejnym uruchomieniu. Jeśli nie, zmień w `sw.js` wartość `CACHE`.
