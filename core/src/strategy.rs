use crate::provider::LlmProvider;
use crate::types::{Latency, Price, Score};
use std::sync::Arc;

/// Weighs price and latency to determine the best provider.
/// A lower score is better.
pub struct WeightedScorer {
    /// Weight given to Price (0.0 to 1.0)
    pub price_weight: f32,
    /// Weight given to Latency (0.0 to 1.0)
    pub latency_weight: f32,
}

impl WeightedScorer {
    pub fn new(price_weight: f32, latency_weight: f32) -> Self {
        // Normalize weights to ensure they sum to 1.0
        let total = price_weight + latency_weight;
        if total == 0.0 {
            // Fallback to equal weighting if both are zero
            return Self {
                price_weight: 0.5,
                latency_weight: 0.5,
            };
        }

        Self {
            price_weight: price_weight / total,
            latency_weight: latency_weight / total,
        }
    }

    /// Calculates a score for a provider based on relative performance vs best knowns.
    /// Score = (weight_p * (current_p / best_p)) + (weight_l * (current_l / best_l))
    pub fn calculate_score<P: LlmProvider>(
        &self,
        provider: &P,
        best_price: Price,
        best_latency: Latency,
    ) -> Score {
        let p_ratio = provider.current_price().0 / best_price.0;
        let l_ratio = provider.current_latency().0 / best_latency.0;

        Score(self.price_weight * p_ratio + self.latency_weight * l_ratio)
    }

    /// Selects the provider with the lowest calculated score.
    pub fn select_best_provider<P: LlmProvider + ?Sized>(
        &self,
        providers: &[Arc<P>],
        best_price: Price,
        best_latency: Latency,
    ) -> Option<Arc<P>> {
        providers
            .iter()
            .min_by(|a, b| {
                let score_a = self.calculate_score(a.as_ref(), best_price, best_latency);
                let score_b = self.calculate_score(b.as_ref(), best_price, best_latency);
                score_a
                    .partial_cmp(&score_b)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned()
    }
}
