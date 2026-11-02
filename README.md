# Odtwarzacz – PWA na iPhone'a

Odtwarzacz plików audio zapisanych na iPhonie. Działa offline, bez Maca, bez konta Apple Developer i bez limitu 7 dni.

## Co potrafi

- Wczytywanie plików z aplikacji Pliki (MP3, M4A/M4B, AAC, WAV, AIFF, FLAC, ALAC; Ogg/Opus zależnie od wersji Safari). Pliki są kopiowane do pamięci aplikacji, więc działają offline.
- Biblioteka, playlisty (tworzenie, zmiana nazwy, kolejność, usuwanie).
- Zapamiętywanie miejsca przerwania dla każdego utworu oraz ostatniej kolejki.
- Przyciski na ekranie blokady: poprzedni/następny albo −15 s/+30 s (do wyboru w Ustawieniach).
- Prędkość odtwarzania (0,75–2×).
- Eksport i import playlist oraz pozycji do pliku JSON.
- Dziennik diagnostyczny, który pokazuje, czy następny utwór włączył się przy zablokowanym ekranie.

## Wdrożenie na GitHub Pages (tylko przeglądarka, bez Gita)

1. Rozpakuj `odtwarzacz.zip` na komputerze.
2. Załóż darmowe konto na github.com i utwórz **publiczne** repozytorium, np. `odtwarzacz`.
3. W repozytorium wybierz **Add file → Upload files** i przeciągnij **zawartość** rozpakowanego folderu (pliki oraz folder `icons`). Zatwierdź przyciskiem **Commit changes**.
4. Wejdź w **Settings → Pages**, w „Branch” wybierz `main` i folder `/ (root)`, kliknij **Save**.
5. Po około minucie strona będzie pod adresem `https://TWOJA-NAZWA.github.io/odtwarzacz/`.

## Na iPhonie

1. Otwórz adres w **Safari**.
2. Dotknij **Dodaj pliki** i wybierz utwory z aplikacji Pliki.
3. Opcjonalnie: Udostępnij → **Dodaj do ekranu początkowego**.
4. W **Ustawieniach** aplikacji dotknij „Poproś o trwałą pamięć”, żeby iOS rzadziej usuwał pliki.

## Test odtwarzania przy zablokowanym ekranie

1. Dodaj 2–3 krótkie utwory (np. po 30 s).
2. Odtwórz pierwszy i zablokuj ekran. Poczekaj, aż skończą się wszystkie.
3. Odblokuj i wejdź w **Ustawienia → Diagnostyka**. Jeśli widzisz „[tło] koniec: …” i zaraz po nim „[tło] gra: …”, to przejście do następnego utworu działa w tle.
4. Sprawdź przyciski na ekranie blokady.
5. Zamknij aplikację (przesuń w górę w przełączniku aplikacji), otwórz ją ponownie i naciśnij ▶ – to sprawdza błąd znany z iOS 26.
6. Powtórz test w zwykłej karcie Safari oraz w wersji z ekranu początkowego i porównaj.

## Aktualizacja aplikacji

Wgraj zmienione pliki do repozytorium. Aplikacja pobiera nową wersję w tle i pokazuje ją przy kolejnym uruchomieniu. Jeśli zmiany się nie pojawiają, zmień w `sw.js` wartość `CACHE` (np. na `odtwarzacz-v2`).

## Ważne

- Kopie plików są w pamięci Safari. Wyczyszczenie danych witryn w ustawieniach Safari je usunie (oryginały zostają w Plikach). Playlisty możesz zabezpieczyć eksportem JSON.
- Ta sama aplikacja otwarta w karcie Safari i z ekranu początkowego ma osobne dane.
- Odtwarzanie w tle zależy od wersji iOS. Patrz dziennik diagnostyczny.
