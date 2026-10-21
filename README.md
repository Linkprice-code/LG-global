# LG B2B 공식인증점 글로벌 · 네이버 SA 리포트

네이버 SA "매체 보고서" CSV로 만든 대시보드입니다. `index.html` 한 파일에 데이터가 들어 있습니다.

## 업데이트 방법

1. 네이버 광고 시스템에서 매체 보고서(일별 포함)를 CSV로 받습니다.
2. 리포트를 다시 만듭니다 (이 PC의 `Desktop\Claude\naver-sa-report` 폴더 기준).

   ```
   node build.js "<매체 보고서 CSV 경로>" "LG B2B 공식인증점 글로벌" "github\index.html"
   ```

3. GitHub Desktop에서 바뀐 `index.html`을 커밋하고 Push 합니다. 1~2분 뒤 Pages 주소에 반영됩니다.

## 주의

- 원본 CSV는 이 저장소에 올리지 않습니다.
- GitHub Pages 주소는 아는 사람 누구나 열 수 있습니다.
