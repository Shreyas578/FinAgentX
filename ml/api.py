"""
FinAgentX — ML Inference API (FastAPI)
Serves predictions from the trained ensemble model.

Start with:
    uvicorn api:app --reload --port 8000

Endpoints:
    GET  /health           → health check
    POST /predict          → single borrower prediction
    POST /predict/batch    → batch predictions
    POST /outcome          → record real loan outcome (continuous learning)
    GET  /stats            → model + learning pipeline stats
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
import os, sys, logging

# Add ml directory to path
sys.path.insert(0, os.path.dirname(__file__))

from ensemble import get_predictor, FEATURES
from continuous_learning import get_learner

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("finagentx.api")

app = FastAPI(
    title="FinAgentX ML API",
    description="Autonomous lending risk assessment engine",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pre-load models on startup
@app.on_event("startup")
async def startup():
    try:
        get_predictor()
        log.info("✅ ML models loaded successfully")
    except RuntimeError as e:
        log.warning(f"⚠️  Models not loaded: {e}")


class BorrowerFeatures(BaseModel):
    tx_frequency:        float = Field(..., ge=0, description="Transactions per month")
    avg_balance:         float = Field(..., ge=0, description="Average wallet balance (ETH)")
    balance_volatility:  float = Field(..., ge=0, description="Balance coefficient of variation")
    repayment_history:   float = Field(..., ge=0, le=1, description="Proportion of loans repaid (0-1)")
    failed_repayments:   int   = Field(..., ge=0, description="Count of failed repayments")
    days_since_active:   int   = Field(..., ge=0, description="Days since last activity")
    wallet:              Optional[str] = Field(None, description="Wallet address (optional)")

class PredictionResponse(BaseModel):
    default_prob:             float
    credit_score:             float
    decision:                 str
    rejection_reason:         Optional[str]
    individual_predictions:   dict
    model_variance:           float
    model_std_dev:            float
    uncertainty_level:        str
    loan_reduction_pct:       float
    interest_increase_bps:    int

class OutcomeRequest(BaseModel):
    wallet:         str
    tx_frequency:   Optional[float] = None
    avg_balance:    Optional[float] = None
    balance_volatility: Optional[float] = None
    repayment_history:  Optional[float] = None
    failed_repayments:  Optional[int]   = None
    days_since_active:  Optional[int]   = None
    actual_default:  bool
    loan_amount:     float

class BatchRequest(BaseModel):
    records: List[BorrowerFeatures]


@app.get("/health")
async def health():
    predictor = get_predictor()
    return {
        "status": "ok",
        "models_loaded": predictor.loaded,
        "features": FEATURES,
        "version": "1.0.0"
    }


@app.post("/predict", response_model=PredictionResponse)
async def predict(borrower: BorrowerFeatures):
    """Run ensemble ML prediction for a single borrower."""
    try:
        predictor = get_predictor()
        features  = borrower.model_dump(exclude={"wallet"})
        result    = predictor.predict(features)
        log.info(f"Predicted: wallet={borrower.wallet or 'N/A'} "
                 f"default={result['default_prob']:.2%} "
                 f"decision={result['decision']}")
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        log.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/batch")
async def predict_batch(req: BatchRequest):
    """Run ensemble predictions for multiple borrowers."""
    try:
        predictor = get_predictor()
        results   = []
        for b in req.records:
            features = b.model_dump(exclude={"wallet"})
            result   = predictor.predict(features)
            result["wallet"] = b.wallet
            results.append(result)
        return {"count": len(results), "predictions": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/outcome")
async def record_outcome(outcome: OutcomeRequest):
    """Record real on-chain loan outcome and trigger continuous learning."""
    try:
        learner = get_learner()
        features = {
            "tx_frequency":      outcome.tx_frequency or 0.0,
            "avg_balance":       outcome.avg_balance or 0.0,
            "balance_volatility": outcome.balance_volatility or 0.0,
            "repayment_history": outcome.repayment_history or 0.0,
            "failed_repayments": outcome.failed_repayments or 0,
            "days_since_active": outcome.days_since_active or 0,
        }
        learner.record_outcome(
            wallet=outcome.wallet,
            features=features,
            actual_default=outcome.actual_default,
            loan_amount=outcome.loan_amount
        )
        return {
            "status": "recorded",
            "buffer_size": len(learner.outcome_buffer),
            "retrain_triggered": len(learner.outcome_buffer) == 0  # was just reset
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats")
async def stats():
    """Return ML pipeline statistics."""
    learner = get_learner()
    return {
        "ml_pipeline": learner.get_stats(),
        "ensemble_weights": {
            "linear": 0.10,
            "ridge":  0.20,
            "lasso":  0.20,
            "random_forest": 0.50
        },
        "decision_threshold": 0.60,
        "features": FEATURES
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
