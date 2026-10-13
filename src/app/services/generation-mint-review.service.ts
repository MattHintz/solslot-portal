import { HttpClient,HttpHeaders } from '@angular/common/http';
import { Injectable,inject } from '@angular/core';
import { firstValueFrom,timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AdminSessionService } from './admin-session.service';
import { GenerationMintReview,MintReviewRequest,validateMintReview } from '../utils/generation-mint-review';
import { canonicalizeJcs } from './property-metadata/property-metadata.service';

@Injectable({providedIn:'root'})
export class GenerationMintReviewService {
  private readonly http=inject(HttpClient);
  private readonly session=inject(AdminSessionService);
  private readonly base=environment.faucetApi+'/admin/generation/mint-reviews';
  private headers(){return new HttpHeaders({Authorization:`Bearer ${this.session.requireJwt()}`});}
  async saved(collectionId:string):Promise<GenerationMintReview|null>{
    const value=await firstValueFrom(this.http.get<{review:GenerationMintReview|null}>(`${this.base}/collection/${encodeURIComponent(collectionId)}`,
      {headers:this.headers()}).pipe(timeout(20_000)));
    if(!value.review)return null;
    const review=validateMintReview(value.review);
    if(review.request.collectionId!==collectionId)throw new Error('Saved mint review belongs to another collection.');
    return review;
  }
  async prepare(request:MintReviewRequest):Promise<GenerationMintReview>{
    request=structuredClone(request);
    const review=validateMintReview(await firstValueFrom(this.http.post<GenerationMintReview>(`${this.base}/prepare`,request,
      {headers:this.headers()}).pipe(timeout(65_000))));
    if(canonicalizeJcs(review.request)!==canonicalizeJcs(request))throw new Error('Prepared mint review differs from the selected sealed revision.');
    return review;
  }
}
