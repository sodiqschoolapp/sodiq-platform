# Reference journals

Hand-checked journals for the calculation module (`docs/spec/14-quality-plan.md`, Journal, "Reference journals": "Every code change must reproduce them to the last point"). `src/reference-journals.test.ts` reads every `.json` file of this folder, refuses a file that does not follow the format below, and compares every expected figure exactly.

A new file needs no code change. Use invented names only (`CLAUDE.md`: no real personal data); the figures may come from real rows of 2025–26 where last year's rule and the new rule are the same.

## Common fields

| Field    | Meaning                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `title`  | What the file shows, in one line.                                                                                           |
| `source` | Who checked it by hand and when, for example `"Academic team, 20 October 2026"`; for a sample, the spec line it comes from. |
| `status` | `"sample"` (taken from the spec by a developer) or `"signed off"` (checked and signed off by the academic team).            |

## A quarter file: one subject, one quarter

| Field              | Meaning                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weights`          | The quarterly distribution: `attendance`, `classwork`, `homework`, `ratingExam` (`null` for a subject without a rating exam), whole numbers totalling 100. |
| `attendanceValues` | `lateValue` and `skippedValue` of the quarter, whole numbers from 0 to 100.                                                                                |
| `quarterClosed`    | `true` or `false`.                                                                                                                                         |
| `students`         | The students, each as below.                                                                                                                               |

A student:

| Field        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | An invented name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `lessons`    | The student's held lessons of the quarter: `mark` (0 to 5, or `null` while not typed), `classworks` and `homeworks` (the homeworks checked at that lesson), each a list of `[number, total]`, with `null` as the number for an empty cell.                                                                                                                                                                                                                                                  |
| `ratingExam` | `null` (no entry), `{ "kind": "score", "score": 49 }`, `{ "kind": "did_not_sit" }`, `{ "kind": "exempt" }` or `{ "kind": "not_held" }`.                                                                                                                                                                                                                                                                                                                                                     |
| `expected`   | `attendance`, `classwork`, `homework`, `ratingExam`, `result`: exact figures, or `null` for a part with no data or "No result"; `shown` and `grade`: whole numbers, or `null` with "No result"; `leftOut`: the weighted parts left out, each `{ "part": "homework", "reason": "no_data" }` (`reason` is `no_data`, `exempt` or `not_held`); `provisional`: `true` or `false`. With "No result", `leftOut` is `[]` and `provisional` is `false`. A key outside this format refuses the file. |

## A year file

`{ "title", "source", "status", "year": { "quarters": [four quarters], "expected": { "result", "shown", "grade", "basedOn" } } }`. A quarter is its exact result, which the module rounds as it is published before the mean (`07`, Calculation rules 10 and 11), or one of `"exempt"`, `"not_assessed"`, `"no_result"`, `"not_in_system"`, `"not_official"`. With no quarter that is a figure, `result`, `shown`, `grade` and `basedOn` are `null`.

## Exact figures

A figure is a string: a decimal that ends (`"49.475"`, `"100"`) or a fraction (`"148/3"`) for one that does not end. It is compared with the module's exact value, never through floating point.
