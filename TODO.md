# Sequoia Agent Framework — Improvement Roadmap

Post-hackathon enhancements for the LLM-orchestrated urban simulation layer.

---

## 1. Agent Memory & Reflection
Add a Smallville-style memory stream where agents store observations and reflect on them to inform future decisions. Currently agents are memoryless — each decision is independent of history.

## 2. Social Network Graphs
Model agent relationships (family, coworkers, friends) and route information/influence through these connections rather than only through spatial proximity. Enables modeling of carpooling, social planning, and information cascades.

## 3. Per-Tick LLM Reasoning
Upgrade key decision points from rule-based probabilities to sparse LLM calls for richer behavioral realism. Use the OpenCity group-and-distill approach to batch similar agents and reduce API calls by 600×.

## 4. Validation Framework
Automated comparison of simulated agent distribution vs real-world data (Waze traffic density, transit ridership, bikeshare utilization). The critical review paper identifies this as the core weakness of generative ABMs.

## 5. Economic Model
Add spending behavior, income levels, and price sensitivity. Agents could choose dining venues based on budget, prefer free parks when low on funds, or alter commute modes based on gas prices.

## 6. Heterogeneous Scheduling
Evaluate different agent types at different frequencies — gig drivers need more frequent decisions than office workers sitting at their desk. Reduces computational waste.

## 7. Real-Time Mode
Toggle between accelerated time (144×) and live clock mode where agents move in sync with the actual city time. Useful for comparing simulated behavior with live traffic feeds.

## 8. Expand City Coverage
Batch-generate personas for all 27 cities (currently scoped to top 8 data-rich cities). Requires Gemini API calls for each city but is a one-time cost.

## 9. Agent Communication
Natural language exchanges between agents at shared POIs. When 3+ agents cluster at a restaurant, generate a brief conversation that could reveal emergent topics (weather complaints, transit delays, event discussions).

## 10. Dynamic Environment Reactivity
Agents detect and respond to mid-simulation weather changes and traffic incidents. Currently the environment snapshot is refreshed every 2 minutes but agents don't notice the transition.

## 11. Population Scaling
Use the MIT archetype approach (AAMAS 2025) to scale from 150 representative agents to 10,000+ by generating archetype clusters that share behavioral parameters but have independent spatial trajectories.

## 12. Cultural Calibration
City-specific behavioral norms beyond infrastructure — prayer times in Istanbul/Cairo, siesta patterns in Buenos Aires/Mexico City, night market culture in Bangkok, golden week effects in Tokyo/Seoul.